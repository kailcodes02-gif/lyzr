"use client";

import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import { useIsFetching, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { graphBatch, graphFetch, graphGetAll, GraphError, isConsentRequiredError, type Page } from "@/lib/graph";
import { isMockMode } from "@/lib/mock";
import { assignColors, loadAssignedColors, mineColor, pickColor, saveAssignedColors, type AssignedColors } from "./colors";
import { DEFAULT_SETTINGS, effectiveTimeZone, loadHidden, loadSettings, saveHidden, saveSettings, type CalendarSettings } from "./settings";
import {
  applyLedger,
  createLedger,
  createVisiblePoller,
  deltaChanged,
  forget,
  GRACE_MS,
  noteCreated,
  noteRemoved,
  POLL_INTERVAL_MS,
  SAFETY_INTERVAL_MS,
  settleAndVerify,
} from "./freshness";
import { toGraphRecurrence } from "./recurrence";
import { instantToWall, stepDate, visibleRange, wallToInstant, wallToOffsetIso } from "./time";
import type { CalEvent, EventDraft, GraphCalendar, GraphEvent, Reminder, ScheduleInformation, ViewKind } from "./types";
import { dedupe } from "./events";
import { calendarQueue, queued } from "./queue";

export const CAL_SCOPES = ["Calendars.ReadWrite"];

// getToken throws ConsentRequiredError (instead of redirecting) when the
// tenant has not approved a scope, so it must count as a consent failure
// here or the consent panel never renders and the query retries the probe.
// The name check covers a duplicated module instance of lib/graph.
export function isConsentError(e: unknown): boolean {
  if (isConsentRequiredError(e)) return true;
  if (e instanceof Error && e.name === "ConsentRequiredError") return true;
  if (e instanceof InteractionRequiredAuthError) return true;
  if (e instanceof GraphError) return e.status === 401 || e.status === 403;
  return false;
}

// ---------- settings + visibility ----------

export function useCalendarSettings() {
  const [settings, setSettings] = useState<CalendarSettings>(() => (typeof window === "undefined" ? DEFAULT_SETTINGS : loadSettings()));
  const update = useCallback((patch: Partial<CalendarSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  return { settings, update, timeZone: effectiveTimeZone(settings) };
}

export function useHiddenCalendars() {
  const [hidden, setHidden] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set() : loadHidden()));
  const toggle = useCallback((id: string) => {
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveHidden(next);
      return next;
    });
  }, []);
  return { hidden, toggle };
}

// ---------- calendars ----------

const CAL_SELECT = "$select=id,name,color,hexColor,isDefaultCalendar,canEdit,canShare,owner,allowedOnlineMeetingProviders,defaultOnlineMeetingProvider";

export function useCalendars() {
  const { instance, accounts } = useMsal();
  return useQuery({
    queryKey: ["calendars", accounts[0]?.homeAccountId],
    enabled: accounts.length > 0 || isMockMode(),
    staleTime: 5 * 60_000,
    retry: (n, e) => !isConsentError(e) && n < 2,
    queryFn: async () => {
      const list = await queued(() => graphGetAll<GraphCalendar>(instance, CAL_SCOPES, `/me/calendars?${CAL_SELECT}`, 100, { immutableIds: false }));
      return list.sort((a, b) => Number(!!b.isDefaultCalendar) - Number(!!a.isDefaultCalendar) || a.name.localeCompare(b.name));
    },
  });
}

// ---------- calendar view ----------

// Fields every list / view request selects. `body` is deliberately absent (it
// is large and HTML); the edit dialog fetches the single event with body.
export const EVENT_FIELDS =
  "id,subject,start,end,isAllDay,location,organizer,attendees,showAs,sensitivity,categories,isOnlineMeeting,onlineMeeting,onlineMeetingProvider,seriesMasterId,type,recurrence,bodyPreview,webLink,responseStatus,isCancelled,importance,reminderMinutesBeforeStart,isReminderOn,isOrganizer";
export const EVENT_SELECT = `$select=${EVENT_FIELDS}`;

export function viewKey(tz: string, start: string, end: string, ids: string[]) {
  return ["calendarView", tz, start, end, [...ids].sort().join(",")] as const;
}

// Calendars in a non-default calendar group are addressed through their group.
export type GroupOf = Record<string, string | undefined>;

export function calendarPath(id: string, groupOf?: GroupOf): string {
  const g = groupOf?.[id];
  return g ? `/me/calendarGroups/${encodeURIComponent(g)}/calendars/${encodeURIComponent(id)}` : `/me/calendars/${encodeURIComponent(id)}`;
}

// One calendar whose calendarView sub-request failed. The other calendars'
// events still render; the UI badges this one.
export type ViewFailure = { id: string; status: number; code: string; message: string };
// `pending`: ids where a confirmed write still disagrees with the server list
// (a just-created event Outlook has not indexed yet, a deleted one it still
// returns); they are shown as the user left them for a short grace period.
export type ViewData = { events: CalEvent[]; failed: ViewFailure[]; pending?: string[] };

// Confirmed writes the server may not reflect yet (see freshness.ts).
const ledger = createLedger();
// Test hook.
export function resetLedger() {
  ledger.created.clear();
  ledger.removed.clear();
}

// Turns $batch sub-responses into events + per-calendar failures. Exported for tests.
export function collectBatch(responses: { id: string; status: number; body?: unknown }[]): { pages: { id: string; page: Page<GraphEvent> }[]; failed: ViewFailure[] } {
  const pages: { id: string; page: Page<GraphEvent> }[] = [];
  const failed: ViewFailure[] = [];
  for (const r of responses) {
    if (r.status >= 400) {
      const body = r.body as { error?: { code?: string; message?: string } } | undefined;
      failed.push({ id: r.id, status: r.status, code: body?.error?.code ?? String(r.status), message: body?.error?.message ?? "calendarView failed" });
      continue;
    }
    pages.push({ id: r.id, page: r.body as Page<GraphEvent> });
  }
  return { pages, failed };
}

async function fetchView(instance: ReturnType<typeof useMsal>["instance"], tz: string, start: string, end: string, ids: string[], groupOf?: GroupOf): Promise<ViewData> {
  if (!ids.length) return { events: [], failed: [] };
  const startIso = encodeURIComponent(wallToOffsetIso(start, tz));
  const endIso = encodeURIComponent(wallToOffsetIso(end, tz));
  const prefer = { Prefer: `outlook.timezone="${tz}"` };
  // Every calendar of the range in ONE $batch (Graph runs the sub-requests
  // itself; the outer request counts once against the mailbox concurrency),
  // through the queue so nothing else runs alongside beyond the limit.
  const responses = await queued(() =>
    graphBatch(
      instance,
      CAL_SCOPES,
      ids.map((id) => ({
        id,
        method: "GET",
        url: `${calendarPath(id, groupOf)}/calendarView?startDateTime=${startIso}&endDateTime=${endIso}&${EVENT_SELECT}&$top=1000`,
        headers: prefer,
      })),
    ),
  );
  const { pages, failed } = collectBatch(responses);
  // Only a consent problem on every calendar is a real failure; a single shared
  // calendar the sharer revoked (404) or that needs Calendars.Read.Shared (403)
  // must not blank the user's own events.
  if (failed.length === responses.length && failed.every((f) => f.status === 401 || f.status === 403)) {
    const f = failed[0];
    throw new GraphError(f.status, f.code, f.message, `${calendarPath(f.id, groupOf)}/calendarView`);
  }
  const out: CalEvent[] = [];
  for (const { id, page } of pages) {
    let items = page.value ?? [];
    if (page["@odata.nextLink"]) {
      const rest = await queued(() => graphGetAll<GraphEvent>(instance, CAL_SCOPES, page["@odata.nextLink"]!, 5000, { headers: prefer, immutableIds: false }));
      items = [...items, ...rest];
    }
    out.push(...items.map((e) => ({ ...e, calendarId: id })));
  }
  const merged = applyLedger(ledger, dedupe(out), { tz, start, end, ids });
  return { events: merged.events, failed, pending: merged.pending };
}

// `ready` false holds the request (e.g. until the calendar groups are known,
// so the range is fetched once with every calendar instead of twice).
export function useCalendarView(tz: string, view: ViewKind, date: string, weekStartsOn: 0 | 1 | 6, calendarIds: string[], groupOf?: GroupOf, ready = true) {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const range = useMemo(() => visibleRange(view, date, weekStartsOn), [view, date, weekStartsOn]);
  const ids = useMemo(() => [...calendarIds].sort(), [calendarIds]);
  const groupKey = ids.map((id) => groupOf?.[id] ?? "").join("|");
  const q = useQuery({
    queryKey: viewKey(tz, range.start, range.end, ids),
    enabled: ids.length > 0 && ready,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    retry: (n, e) => !isConsentError(e) && n < 2,
    queryFn: () => fetchView(instance, tz, range.start, range.end, ids, groupOf),
  });
  // Prefetch the neighbouring ranges so j/k feel instant: only once the
  // current range is on screen, so the prefetches never compete with it.
  const loaded = q.isSuccess && !q.isFetching;
  useEffect(() => {
    if (!ids.length || !loaded) return;
    for (const dir of [1, -1] as const) {
      const r = visibleRange(view, stepDate(view, date, dir), weekStartsOn);
      void qc.prefetchQuery({ queryKey: viewKey(tz, r.start, r.end, ids), staleTime: 30_000, queryFn: () => fetchView(instance, tz, r.start, r.end, ids, groupOf) });
    }
    // groupOf is keyed by groupKey to avoid re-running on every new object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, instance, tz, view, date, weekStartsOn, ids, loaded, groupKey]);
  return { ...q, data: q.data?.events, failed: q.data?.failed ?? [], range };
}

// ---------- live refresh ----------
//
// The freshness contract: while the tab is visible the default calendar's
// delta is polled every 15 s (jittered) and every calendar is refetched every
// 120 s as a safety net; coming back to the tab or focusing the window refetches
// at once (at most once per 10 s); a manual refresh does everything. Hidden
// tabs do not poll, and nothing polls for 30 s after Microsoft throttled us.
// The delta round only starts once the initial calendarView has loaded
// (`enabled` carries that), so it never competes with the first paint.

// Refetch every active server query the grid draws from. Resolves once the
// data is back in the cache.
export async function refreshServerData(qc: QueryClient) {
  await Promise.all([settleViews(qc), qc.invalidateQueries({ queryKey: ["colleagueSchedule"] }), qc.invalidateQueries({ queryKey: ["colleagueShared"] })]);
}

// Mutations ask the delta poller to run once their refetch is done, so the
// token moves past their own change instead of reporting it on the next tick.
const deltaWakers = new Set<() => void>();
function wakeDelta() {
  for (const w of deltaWakers) w();
}

// Every event the cached views currently show, by id (delta items are compared against it).
function cachedById(qc: QueryClient): Map<string, GraphEvent> {
  const map = new Map<string, GraphEvent>();
  for (const [, data] of qc.getQueriesData<ViewData>({ queryKey: ["calendarView"] })) for (const ev of data?.events ?? []) map.set(ev.id, ev);
  return map;
}

export type LiveRefresh = { lastChecked: number | null; refresh: () => void; refreshing: boolean };

// A focus / visibility refetch at most this often.
export const FOCUS_THROTTLE_MS = 10_000;

// The initial delta round of a range only yields a token (it returns what the
// calendarView batch already fetched), so it runs after a short delay and never
// invalidates; the deltaLink is kept per (tz, range) so stepping back is one
// small call.
export function useLiveRefresh(tz: string, range: { start: string; end: string }, enabled: boolean): LiveRefresh {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const links = useRef(new Map<string, string>());
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const wakeRef = useRef<() => void>(() => {});
  const rangeKey = `${tz}|${range.start}|${range.end}`;
  const fetching = useIsFetching({ queryKey: ["calendarView"] });

  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const tick = async (manual = false) => {
      if (stop) return;
      const known = links.current.get(rangeKey);
      // A scheduled tick while a view request is bringing fresh data has nothing to add.
      if (known && !manual && qc.isFetching({ queryKey: ["calendarView"] }) > 0) return;
      // Microsoft asked us to slow down: the pollers stay quiet for a while.
      if (!manual && calendarQueue.isPaused()) return;
      try {
        let url = known ?? `/me/calendarView/delta?startDateTime=${encodeURIComponent(wallToOffsetIso(range.start, tz))}&endDateTime=${encodeURIComponent(wallToOffsetIso(range.end, tz))}`;
        const init = known ? { immutableIds: false, headers: { Prefer: "odata.maxpagesize=50" } } : { immutableIds: false };
        let page = await queued(() => graphFetch<Page<GraphEvent>>(instance, CAL_SCOPES, url, init));
        const items: GraphEvent[] = known ? [...(page.value ?? [])] : [];
        while (page["@odata.nextLink"]) {
          if (stop) return;
          url = page["@odata.nextLink"];
          page = await queued(() => graphFetch<Page<GraphEvent>>(instance, CAL_SCOPES, url, init));
          if (known) items.push(...(page.value ?? []));
        }
        if (page["@odata.deltaLink"]) links.current.set(rangeKey, page["@odata.deltaLink"]);
        if (stop) return;
        setLastChecked(Date.now());
        if (known && deltaChanged(cachedById(qc), items)) void refreshServerData(qc);
      } catch {
        // polling is best effort; the next tick retries (a dead token is dropped so the next round starts fresh)
        if (known) links.current.delete(rangeKey);
      }
    };
    const poller = createVisiblePoller({ intervalMs: POLL_INTERVAL_MS, run: () => tick(), isVisible, initialDelayMs: links.current.has(rangeKey) ? 0 : 1_000 });
    poller.start();
    // Safety net: a full refetch of every calendar (the delta only covers the
    // default one) every two minutes while visible, skipped while throttled.
    const safety = createVisiblePoller({ intervalMs: SAFETY_INTERVAL_MS, run: () => (calendarQueue.isPaused() ? undefined : refreshServerData(qc)), isVisible });
    safety.start();
    // Back to the tab / window: refetch now (throttled so focus flapping does not hammer Graph).
    let lastWake = 0;
    const wake = (force = false) => {
      if (stop || !isVisible()) return;
      const now = Date.now();
      if (!force && now - lastWake < FOCUS_THROTTLE_MS) return;
      if (!force && calendarQueue.isPaused()) return;
      lastWake = now;
      void refreshServerData(qc).then(() => {
        if (!stop) void tick(true);
      });
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        wake(); // refetch now, then a delta round
        poller.resume(); // both pollers paused while hidden: restart their cadence
        safety.resume();
      }
    };
    const onFocus = () => wake();
    // After a write: consume our own change so the next poll stays quiet.
    const afterWrite = () => {
      if (!stop) void tick(true);
    };
    wakeRef.current = () => wake(true);
    deltaWakers.add(afterWrite);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => {
      stop = true;
      poller.stop();
      safety.stop();
      deltaWakers.delete(afterWrite);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      wakeRef.current = () => {};
    };
  }, [enabled, instance, qc, rangeKey, tz, range.start, range.end]);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["calendars"] });
    void qc.invalidateQueries({ queryKey: ["calendarGroups"] });
    wakeRef.current();
  }, [qc]);
  return { lastChecked, refresh, refreshing: fetching > 0 };
}

// ---------- colours ----------

// Calendars the user owns are blue (two close shades when there are several);
// every other calendar gets a distinct palette colour, assigned in order of
// appearance and persisted so it stays the same next time. Colleague colours
// are taken into account so nobody shares a colour with a shared calendar.
export function useCalendarColors(mine: GraphCalendar[], other: GraphCalendar[], colleagueColors: string[], dark: boolean): (calendarId: string) => string {
  const [stored] = useState<AssignedColors>(() => (typeof window === "undefined" ? {} : loadAssignedColors()));
  const otherKey = other.map((c) => c.id).join("|");
  const colleagueKey = colleagueColors.join("|");
  // Keyed by the joined strings so a new array identity does not reassign.
  const assigned = useMemo(() => assignColors(stored, otherKey ? otherKey.split("|") : [], colleagueKey ? colleagueKey.split("|") : []), [stored, otherKey, colleagueKey]);
  useEffect(() => {
    if (assigned !== stored) saveAssignedColors({ ...loadAssignedColors(), ...assigned });
  }, [assigned, stored]);
  const mineKey = mine.map((c) => c.id).join("|");
  return useCallback(
    (calendarId: string) => {
      const i = mineKey ? mineKey.split("|").indexOf(calendarId) : -1;
      if (i >= 0) return mineColor(i, dark);
      return assigned[calendarId] ?? pickColor(Object.values(assigned));
    },
    [mineKey, assigned, dark],
  );
}

// ---------- time zones ----------

// Fetched once, lazily (the settings dialog asks for it when it opens).
export function useSupportedTimeZones(enabled = true) {
  const { instance } = useMsal();
  return useQuery({
    queryKey: ["supportedTimeZones"],
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => {
      const list = await queued(() => graphGetAll<{ alias: string; displayName: string }>(instance, ["User.Read"], "/me/outlook/supportedTimeZones(TimeZoneStandard=microsoft.graph.timeZoneStandard'Iana')", 1000, { immutableIds: false }));
      return list.map((z) => z.alias).sort();
    },
  });
}

// ---------- single event with body ----------

// The full event (with its HTML/text body). calendarView deliberately omits
// `body`, so the detail popover and the edit dialog fetch it here, through the queue.
export function fetchEventWithBody(instance: ReturnType<typeof useMsal>["instance"], id: string, tz: string): Promise<GraphEvent> {
  return queued(() =>
    graphFetch<GraphEvent>(instance, CAL_SCOPES, `/me/events/${encodeURIComponent(id)}?$select=${EVENT_FIELDS},body`, {
      immutableIds: false,
      headers: { Prefer: `outlook.timezone="${tz}"` },
    }),
  );
}

// Body of the selected event for the detail popover; only asked for when the
// cached copy has none (e.g. a colleague's overlay never has one).
export function useEventBody(id: string | null, tz: string, enabled: boolean) {
  const { instance } = useMsal();
  return useQuery({
    queryKey: ["eventBody", id, tz],
    enabled: enabled && !!id,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const ev = await fetchEventWithBody(instance, id!, tz);
      return ev.body ?? { contentType: "text" as const, content: ev.bodyPreview ?? "" };
    },
  });
}

// ---------- mutations ----------

type Snapshot = [readonly unknown[], unknown][];

function snapshot(qc: QueryClient): Snapshot {
  return qc.getQueriesData({ queryKey: ["calendarView"] });
}
function restore(qc: QueryClient, snap: Snapshot) {
  for (const [key, data] of snap) qc.setQueryData(key, data);
}
// Applies fn to every cached view. With `seed`, a view that has no data yet
// (its first fetch still in flight) is seeded with an empty list so an
// optimistic insert shows at once instead of being dropped.
function updateViews(qc: QueryClient, fn: (list: CalEvent[]) => CalEvent[], seed = false) {
  qc.setQueriesData<ViewData>({ queryKey: ["calendarView"] }, (old) => {
    if (!old) return seed ? { events: fn([]), failed: [] } : old;
    return { ...old, events: fn(old.events) };
  });
}
// A view whose first fetch is still running has data === undefined; TanStack
// would reuse that in-flight promise on invalidate (its result predates the
// write), so such fetches are cancelled first and restarted by the invalidate.
async function settleViews(qc: QueryClient) {
  await qc.cancelQueries({ queryKey: ["calendarView"], predicate: (q) => q.state.data === undefined });
  await qc.invalidateQueries({ queryKey: ["calendarView"] });
}

// After a write: refetch server data now and again at 2.5 s (Outlook applies
// rules, provisions Teams meetings and updates its indexes asynchronously),
// then let the delta poller consume the change. When `verify` still fails
// after the second refetch, one more at 8 s precedes the explanation toast.
// Timers are owned by the QueryClient's lifetime, not the component's, so a
// page change right after a write still reconciles the cache.
function settleAfterWrite(qc: QueryClient, verify?: () => boolean, onStillWrong?: () => void) {
  settleAndVerify(() => refreshServerData(qc).then(wakeDelta), verify, onStillWrong);
}

// The cached copy of an event across every view, or undefined; `pending` tells
// whether the server list still disagrees with the write for that id.
function cachedState(qc: QueryClient, id: string): { ev?: CalEvent; pending: boolean } {
  let ev: CalEvent | undefined;
  let pending = false;
  for (const [, data] of qc.getQueriesData<ViewData>({ queryKey: ["calendarView"] })) {
    if (!data) continue;
    if (data.pending?.includes(id)) pending = true;
    ev = ev ?? data.events.find((e) => e.id === id);
  }
  return { ev, pending };
}
// A created event is confirmed once some view lists it without the ledger's help.
function serverShows(qc: QueryClient, id: string): boolean {
  const { ev, pending } = cachedState(qc, id);
  return !!ev && !pending;
}
// A removed event is confirmed gone once no view has it (with or without the ledger).
function serverDropped(qc: QueryClient, id: string): boolean {
  const { ev, pending } = cachedState(qc, id);
  return !ev && !pending;
}

// The Graph event body for a draft (POST). The recurrence is derived from the
// editor form at this moment so range.startDate always equals the start date.
export function draftToGraph(d: EventDraft, tz: string, defaultReminder: number | null): Partial<GraphEvent> & { transactionId?: string } {
  const start = d.allDay ? `${d.start.slice(0, 10)}T00:00:00` : d.start.length === 16 ? `${d.start}:00` : d.start;
  const end = d.allDay ? `${d.end.slice(0, 10)}T00:00:00` : d.end.length === 16 ? `${d.end}:00` : d.end;
  // draft.reminder null = "No reminder"; undefined (never set) falls back to the settings default.
  const reminder = d.reminder === undefined ? defaultReminder : d.reminder;
  const recurrence = d.recurrenceForm ? toGraphRecurrence(d.recurrenceForm, d.start.slice(0, 10), tz) : d.recurrence;
  return {
    subject: d.subject.trim() || "(No title)",
    body: { contentType: "text", content: d.description },
    start: { dateTime: start, timeZone: tz },
    end: { dateTime: end, timeZone: tz },
    isAllDay: d.allDay,
    location: { displayName: d.location },
    attendees: d.attendees.map((a) => ({ type: "required", emailAddress: { address: a.email, name: a.name } })),
    isOnlineMeeting: d.teams,
    onlineMeetingProvider: d.teams ? "teamsForBusiness" : undefined,
    isReminderOn: reminder !== null,
    reminderMinutesBeforeStart: reminder ?? 0,
    recurrence,
    showAs: d.showAs,
    sensitivity: d.isPrivate ? "private" : "normal",
  };
}

// A recurrence whose end date precedes the start cannot be saved.
export function recurrenceProblem(d: EventDraft): string | null {
  const f = d.recurrenceForm;
  if (!f || f.preset === "none") return null;
  if (f.ends === "on" && f.endDate && f.endDate < d.start.slice(0, 10)) return "The repeat end date is before the event starts.";
  return null;
}

export function useEventMutations(tz: string) {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const onSettled = () => settleAfterWrite(qc);

  const create = useMutation({
    mutationFn: async (input: { calendarId: string; body: Partial<GraphEvent> }) => {
      const body = { ...input.body, transactionId: crypto.randomUUID() };
      return queued(() => graphFetch<GraphEvent>(instance, CAL_SCOPES, `/me/calendars/${encodeURIComponent(input.calendarId)}/events`, { method: "POST", body, immutableIds: false, headers: { Prefer: `outlook.timezone="${tz}"` } }));
    },
    onMutate: (input) => {
      const snap = snapshot(qc);
      const temp: CalEvent = { ...(input.body as GraphEvent), id: `temp-${Date.now()}`, calendarId: input.calendarId, type: "singleInstance" };
      if (!temp.recurrence) updateViews(qc, (l) => [...l, temp], true);
      return { snap, tempId: temp.id };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast.error("Could not create the event", { description: (e as Error).message });
    },
    onSuccess: (created, input, ctx) => {
      // Replace the optimistic row, or add the created event when a fetch that
      // finished in between overwrote the optimistic list.
      const real: CalEvent = { ...created, calendarId: input.calendarId };
      if (!real.recurrence) {
        noteCreated(ledger, real);
        updateViews(qc, (l) => {
          const hasTemp = l.some((ev) => ev.id === ctx?.tempId);
          if (hasTemp) return l.map((ev) => (ev.id === ctx?.tempId ? real : ev));
          return l.some((ev) => ev.id === real.id) ? l : [...l, real];
        }, true);
      }
      toast.success("Event created", { duration: 6000 });
    },
    onSettled: (created, _e, input) => {
      if (!created || created.recurrence) return settleAfterWrite(qc);
      const wantsTeams = !!input.body.isOnlineMeeting;
      const label = created.subject || "(No title)";
      settleAfterWrite(
        qc,
        () => {
          const { ev, pending } = cachedState(qc, created.id);
          if (!ev) return true; // outside every cached range: nothing to check
          if (pending) return false;
          return !wantsTeams || !!ev.onlineMeeting?.joinUrl;
        },
        () => {
          if (serverShows(qc, created.id)) toast(`Teams link for "${label}" is still being set up`, { description: "Outlook adds the join link a little after the event; it will show on the next refresh." });
          else toast.error(`"${label}" has not appeared on your Outlook calendar yet`, { description: "Microsoft accepted it but the calendar view does not list it. Refresh in a moment." });
        },
      );
    },
  });

  const patch = useMutation({
    mutationFn: (input: { id: string; body: Partial<GraphEvent>; quiet?: boolean }) =>
      queued(() => graphFetch<GraphEvent>(instance, CAL_SCOPES, `/me/events/${encodeURIComponent(input.id)}`, { method: "PATCH", body: input.body, immutableIds: false, headers: { Prefer: `outlook.timezone="${tz}"` } })),
    onMutate: (input) => {
      const snap = snapshot(qc);
      updateViews(qc, (l) => l.map((ev) => (ev.id === input.id ? { ...ev, ...(input.body as Partial<CalEvent>) } : ev)));
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      const ge = e as GraphError;
      if (ge.code === "ErrorOccurrenceCrossingBoundary") toast.error("An occurrence cannot be moved past the one before or after it");
      else toast.error("Could not update the event", { description: ge.message });
    },
    onSuccess: (_d, input) => {
      if (!input.quiet) toast.success("Event updated");
    },
    onSettled,
  });

  const remove = useMutation({
    mutationFn: async (input: { id: string; mode: "delete" | "cancel" | "declineDelete"; comment?: string; snap?: Snapshot }) => {
      const path = `/me/events/${encodeURIComponent(input.id)}`;
      if (input.mode === "cancel") return queued(() => graphFetch(instance, CAL_SCOPES, `${path}/cancel`, { method: "POST", body: { comment: input.comment ?? "" }, immutableIds: false }));
      if (input.mode === "declineDelete") {
        await queued(() => graphFetch(instance, CAL_SCOPES, `${path}/decline`, { method: "POST", body: { sendResponse: true, comment: input.comment ?? "" }, immutableIds: false }));
        try {
          await queued(() => graphFetch(instance, CAL_SCOPES, path, { method: "DELETE", immutableIds: false }));
        } catch (e) {
          if (!(e instanceof GraphError && e.status === 404)) throw e; // decline may already have removed it
        }
        return;
      }
      return queued(() => graphFetch(instance, CAL_SCOPES, path, { method: "DELETE", immutableIds: false }));
    },
    onMutate: (input) => {
      // A delayed delete already removed the event from the cache; its snapshot
      // (taken before that) is what a rollback must restore.
      const snap = input.snap ?? snapshot(qc);
      noteRemoved(ledger, input.id);
      updateViews(qc, (l) => l.filter((ev) => ev.id !== input.id && ev.seriesMasterId !== input.id));
      return { snap };
    },
    onError: (e, input, ctx) => {
      forget(ledger, input.id);
      if (ctx) restore(qc, ctx.snap);
      toast.error("Could not delete the event", { description: (e as Error).message });
    },
    onSettled: (_d, e, input) => {
      if (e) return settleAfterWrite(qc);
      settleAfterWrite(
        qc,
        () => serverDropped(qc, input.id),
        () => toast.error("Outlook still lists the event you removed", { description: "The change was accepted; it may take a moment to disappear. Refresh to check." }),
      );
    },
  });

  const rsvp = useMutation({
    mutationFn: (input: { id: string; action: "accept" | "tentativelyAccept" | "decline"; comment?: string }) =>
      queued(() => graphFetch(instance, CAL_SCOPES, `/me/events/${encodeURIComponent(input.id)}/${input.action}`, { method: "POST", body: { sendResponse: true, comment: input.comment ?? "" }, immutableIds: false })),
    onMutate: (input) => {
      const snap = snapshot(qc);
      const response = input.action === "accept" ? "accepted" : input.action === "decline" ? "declined" : "tentativelyAccepted";
      if (input.action === "decline") noteRemoved(ledger, input.id);
      updateViews(qc, (l) => (input.action === "decline" ? l.filter((ev) => ev.id !== input.id) : l.map((ev) => (ev.id === input.id ? { ...ev, responseStatus: { response } } : ev))));
      return { snap };
    },
    onError: (e, input, ctx) => {
      forget(ledger, input.id);
      if (ctx) restore(qc, ctx.snap);
      toast.error("Could not send your response", { description: (e as Error).message });
    },
    onSuccess: (_d, input) => toast.success(input.action === "accept" ? "Accepted" : input.action === "decline" ? "Declined" : "Marked as tentative"),
    onSettled: (_d, e, input) => {
      if (e) return settleAfterWrite(qc);
      const want = input.action === "accept" ? "accepted" : "tentativelyAccepted";
      settleAfterWrite(
        qc,
        () => {
          if (input.action === "decline") return serverDropped(qc, input.id);
          const { ev } = cachedState(qc, input.id);
          return !ev || ev.responseStatus?.response === want;
        },
        () => toast.error("Outlook has not recorded your response yet", { description: "It was sent; the calendar view may take a moment to reflect it." }),
      );
    },
  });

  return { create, patch, remove, rsvp };
}

// Delete with a 5 s undo toast: the network call is delayed, the cache updated at once.
export function useDelayedDelete(tz: string) {
  const { remove } = useEventMutations(tz);
  const qc = useQueryClient();
  return useCallback(
    (input: { id: string; mode: "delete" | "cancel" | "declineDelete"; comment?: string; label?: string }) => {
      const snap = snapshot(qc);
      // A poll or focus refetch during the undo window must not bring the row back.
      noteRemoved(ledger, input.id, Date.now(), 5000 + GRACE_MS);
      updateViews(qc, (l) => l.filter((ev) => ev.id !== input.id && ev.seriesMasterId !== input.id));
      let undone = false;
      const timer = setTimeout(() => {
        // The pre-removal snapshot travels with the mutation so a 4xx/5xx puts the event back.
        if (!undone) remove.mutate({ ...input, snap });
      }, 5000);
      toast(input.label ?? "Event deleted", {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            undone = true;
            clearTimeout(timer);
            forget(ledger, input.id);
            restore(qc, snap);
          },
        },
      });
    },
    [qc, remove],
  );
}

// ---------- find a time ----------

export function useSchedule(emails: string[], day: string, tz: string, enabled: boolean) {
  const { instance } = useMsal();
  const list = useMemo(() => Array.from(new Set(emails.map((e) => e.toLowerCase()))).slice(0, 20), [emails]);
  return useQuery({
    queryKey: ["getSchedule", list.join(","), day, tz],
    enabled: enabled && list.length > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const res = await queued(() =>
        graphFetch<{ value: ScheduleInformation[] }>(instance, ["Calendars.ReadWrite"], "/me/calendar/getSchedule", {
          method: "POST",
          immutableIds: false,
          headers: { Prefer: `outlook.timezone="${tz}"` },
          body: { schedules: list, startTime: { dateTime: `${day}T08:00:00`, timeZone: tz }, endTime: { dateTime: `${day}T20:00:00`, timeZone: tz }, availabilityViewInterval: 30 },
        }),
      );
      return res.value;
    },
  });
}

// ---------- reminders ----------

// Browser notifications are only sent when the user switched them on in
// settings (which is where the permission is requested, from a click). The
// caller enables this only once the calendar view has loaded, so the first
// reminderView call never competes with the view fetch.
export function useReminders(tz: string, enabled: boolean, desktop = false) {
  const { instance } = useMsal();
  const fired = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!enabled) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const poll = async () => {
      try {
        const now = new Date();
        const end = new Date(now.getTime() + 6 * 60_000 + 60 * 60_000);
        const path = `/me/reminderView(startDateTime='${encodeURIComponent(now.toISOString())}',endDateTime='${encodeURIComponent(end.toISOString())}')`;
        const res = await queued(() => graphFetch<{ value: Reminder[] }>(instance, CAL_SCOPES, path, { immutableIds: false }));
        for (const t of timers) clearTimeout(t);
        timers = [];
        for (const r of res.value ?? []) {
          const key = `${r.eventId}|${r.reminderFireTime.dateTime}`;
          if (fired.current.has(key)) continue;
          const fireAt = wallToInstant(r.reminderFireTime.dateTime.replace(/\.\d+$/, ""), r.reminderFireTime.timeZone || "UTC").getTime();
          const delay = Math.max(0, fireAt - Date.now());
          if (delay > 6 * 60_000) continue;
          timers.push(
            setTimeout(() => {
              fired.current.add(key);
              const startWall = instantToWall(wallToInstant(r.eventStartTime.dateTime.replace(/\.\d+$/, ""), r.eventStartTime.timeZone || "UTC"), tz);
              const when = startWall.slice(11, 16);
              toast(r.eventSubject || "Reminder", { description: `Starts at ${when}${r.eventLocation?.displayName ? ` at ${r.eventLocation.displayName}` : ""}`, duration: 15_000 });
              try {
                if (desktop && typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(r.eventSubject || "Reminder", { body: `Starts at ${when}` });
              } catch {
                // notifications unavailable
              }
            }, delay),
          );
        }
      } catch {
        // best effort
      }
    };
    void poll();
    const id = setInterval(poll, 5 * 60_000);
    return () => {
      clearInterval(id);
      for (const t of timers) clearTimeout(t);
    };
  }, [enabled, instance, tz, desktop]);
}
