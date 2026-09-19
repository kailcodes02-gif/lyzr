"use client";

import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { useMsal } from "@azure/msal-react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { graphBatch, graphFetch, graphGetAll, GraphError, type Page } from "@/lib/graph";
import { isMockMode } from "@/lib/mock";
import { DEFAULT_SETTINGS, effectiveTimeZone, loadHidden, loadSettings, saveHidden, saveSettings, type CalendarSettings } from "./settings";
import { instantToWall, stepDate, visibleRange, wallToInstant, wallToOffsetIso } from "./time";
import type { CalEvent, EventDraft, GraphCalendar, GraphEvent, Reminder, ScheduleInformation, ViewKind } from "./types";
import { dedupe } from "./events";

export const CAL_SCOPES = ["Calendars.ReadWrite"];

export function isConsentError(e: unknown): boolean {
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

const CAL_SELECT = "$select=id,name,color,hexColor,isDefaultCalendar,canEdit,owner,allowedOnlineMeetingProviders,defaultOnlineMeetingProvider";

export function useCalendars() {
  const { instance, accounts } = useMsal();
  return useQuery({
    queryKey: ["calendars", accounts[0]?.homeAccountId],
    enabled: accounts.length > 0 || isMockMode(),
    staleTime: 5 * 60_000,
    retry: (n, e) => !isConsentError(e) && n < 2,
    queryFn: async () => {
      const list = await graphGetAll<GraphCalendar>(instance, CAL_SCOPES, `/me/calendars?${CAL_SELECT}`, 100, { immutableIds: false });
      return list.sort((a, b) => Number(!!b.isDefaultCalendar) - Number(!!a.isDefaultCalendar) || a.name.localeCompare(b.name));
    },
  });
}

// ---------- calendar view ----------

export const EVENT_SELECT =
  "$select=id,subject,start,end,isAllDay,location,organizer,attendees,showAs,sensitivity,categories,isOnlineMeeting,onlineMeeting,onlineMeetingProvider,seriesMasterId,type,recurrence,bodyPreview,webLink,responseStatus,isCancelled,importance,reminderMinutesBeforeStart,isReminderOn,isOrganizer";

export function viewKey(tz: string, start: string, end: string, ids: string[]) {
  return ["calendarView", tz, start, end, [...ids].sort().join(",")] as const;
}

async function fetchView(instance: ReturnType<typeof useMsal>["instance"], tz: string, start: string, end: string, ids: string[]): Promise<CalEvent[]> {
  if (!ids.length) return [];
  const startIso = encodeURIComponent(wallToOffsetIso(start, tz));
  const endIso = encodeURIComponent(wallToOffsetIso(end, tz));
  const prefer = { Prefer: `outlook.timezone="${tz}"` };
  const responses = await graphBatch(
    instance,
    CAL_SCOPES,
    ids.map((id) => ({
      id,
      method: "GET",
      url: `/me/calendars/${encodeURIComponent(id)}/calendarView?startDateTime=${startIso}&endDateTime=${endIso}&${EVENT_SELECT}&$top=1000`,
      headers: prefer,
    })),
  );
  const out: CalEvent[] = [];
  for (const r of responses) {
    if (r.status >= 400) {
      const body = r.body as { error?: { code?: string; message?: string } } | undefined;
      throw new GraphError(r.status, body?.error?.code ?? String(r.status), body?.error?.message ?? "calendarView failed", `/me/calendars/${r.id}/calendarView`);
    }
    const page = r.body as Page<GraphEvent>;
    let items = page.value ?? [];
    if (page["@odata.nextLink"]) {
      const rest = await graphGetAll<GraphEvent>(instance, CAL_SCOPES, page["@odata.nextLink"], 5000, { headers: prefer, immutableIds: false });
      items = [...items, ...rest];
    }
    out.push(...items.map((e) => ({ ...e, calendarId: r.id })));
  }
  return dedupe(out);
}

export function useCalendarView(tz: string, view: ViewKind, date: string, weekStartsOn: 0 | 1 | 6, calendarIds: string[]) {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const range = useMemo(() => visibleRange(view, date, weekStartsOn), [view, date, weekStartsOn]);
  const ids = useMemo(() => [...calendarIds].sort(), [calendarIds]);
  const q = useQuery({
    queryKey: viewKey(tz, range.start, range.end, ids),
    enabled: ids.length > 0,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    retry: (n, e) => !isConsentError(e) && n < 2,
    queryFn: () => fetchView(instance, tz, range.start, range.end, ids),
  });
  // Prefetch the neighbouring ranges so j/k feel instant.
  useEffect(() => {
    if (!ids.length || q.isError) return;
    for (const dir of [1, -1] as const) {
      const r = visibleRange(view, stepDate(view, date, dir), weekStartsOn);
      void qc.prefetchQuery({ queryKey: viewKey(tz, r.start, r.end, ids), staleTime: 30_000, queryFn: () => fetchView(instance, tz, r.start, r.end, ids) });
    }
  }, [qc, instance, tz, view, date, weekStartsOn, ids, q.isError]);
  return { ...q, range };
}

// Delta polling on the default calendar every 60 s while the tab is visible.
export function useDeltaRefresh(tz: string, range: { start: string; end: string }, enabled: boolean) {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const linkRef = useRef<string | null>(null);
  const rangeKey = `${range.start}|${range.end}`;
  useEffect(() => {
    linkRef.current = null;
  }, [rangeKey, tz]);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const tick = async () => {
      if (stop || document.visibilityState !== "visible") return;
      try {
        const url =
          linkRef.current ??
          `/me/calendarView/delta?startDateTime=${encodeURIComponent(wallToOffsetIso(range.start, tz))}&endDateTime=${encodeURIComponent(wallToOffsetIso(range.end, tz))}`;
        let page = await graphFetch<Page<GraphEvent>>(instance, CAL_SCOPES, url, { immutableIds: false });
        let changed = linkRef.current ? page.value.length > 0 : false;
        while (page["@odata.nextLink"]) {
          page = await graphFetch<Page<GraphEvent>>(instance, CAL_SCOPES, page["@odata.nextLink"], { immutableIds: false });
          changed = changed || (!!linkRef.current && page.value.length > 0);
        }
        if (page["@odata.deltaLink"]) linkRef.current = page["@odata.deltaLink"];
        if (changed) void qc.invalidateQueries({ queryKey: ["calendarView"] });
      } catch {
        // polling is best effort; the next tick retries
      }
    };
    void tick();
    const id = setInterval(tick, 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [enabled, instance, qc, rangeKey, tz, range.start, range.end]);
}

// ---------- time zones ----------

export function useSupportedTimeZones() {
  const { instance } = useMsal();
  return useQuery({
    queryKey: ["supportedTimeZones"],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => {
      const list = await graphGetAll<{ alias: string; displayName: string }>(instance, ["User.Read"], "/me/outlook/supportedTimeZones(TimeZoneStandard=microsoft.graph.timeZoneStandard'Iana')", 1000, { immutableIds: false });
      return list.map((z) => z.alias).sort();
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
function updateViews(qc: QueryClient, fn: (list: CalEvent[]) => CalEvent[]) {
  qc.setQueriesData<CalEvent[]>({ queryKey: ["calendarView"] }, (old) => (old ? fn(old) : old));
}

export function draftToGraph(d: EventDraft, tz: string, defaultReminder: number | null): Partial<GraphEvent> & { transactionId?: string } {
  const start = d.allDay ? `${d.start.slice(0, 10)}T00:00:00` : d.start.length === 16 ? `${d.start}:00` : d.start;
  const end = d.allDay ? `${d.end.slice(0, 10)}T00:00:00` : d.end.length === 16 ? `${d.end}:00` : d.end;
  const reminder = d.reminder ?? defaultReminder;
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
    recurrence: d.recurrence,
    showAs: d.showAs,
    sensitivity: d.isPrivate ? "private" : "normal",
  };
}

export function useEventMutations(tz: string) {
  const { instance } = useMsal();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["calendarView"] });

  const create = useMutation({
    mutationFn: async (input: { calendarId: string; body: Partial<GraphEvent> }) => {
      const body = { ...input.body, transactionId: crypto.randomUUID() };
      return graphFetch<GraphEvent>(instance, CAL_SCOPES, `/me/calendars/${encodeURIComponent(input.calendarId)}/events`, { method: "POST", body, immutableIds: false, headers: { Prefer: `outlook.timezone="${tz}"` } });
    },
    onMutate: (input) => {
      const snap = snapshot(qc);
      const temp: CalEvent = { ...(input.body as GraphEvent), id: `temp-${Date.now()}`, calendarId: input.calendarId, type: "singleInstance" };
      if (!temp.recurrence) updateViews(qc, (l) => [...l, temp]);
      return { snap, tempId: temp.id };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast.error("Could not create the event", { description: (e as Error).message });
    },
    onSuccess: (created, input, ctx) => {
      updateViews(qc, (l) => l.map((ev) => (ev.id === ctx?.tempId ? { ...created, calendarId: input.calendarId } : ev)));
      toast.success("Event created");
    },
    onSettled: () => invalidate(),
  });

  const patch = useMutation({
    mutationFn: (input: { id: string; body: Partial<GraphEvent>; quiet?: boolean }) =>
      graphFetch<GraphEvent>(instance, CAL_SCOPES, `/me/events/${encodeURIComponent(input.id)}`, { method: "PATCH", body: input.body, immutableIds: false, headers: { Prefer: `outlook.timezone="${tz}"` } }),
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
    onSettled: () => invalidate(),
  });

  const remove = useMutation({
    mutationFn: async (input: { id: string; mode: "delete" | "cancel" | "declineDelete"; comment?: string }) => {
      const path = `/me/events/${encodeURIComponent(input.id)}`;
      if (input.mode === "cancel") return graphFetch(instance, CAL_SCOPES, `${path}/cancel`, { method: "POST", body: { comment: input.comment ?? "" }, immutableIds: false });
      if (input.mode === "declineDelete") {
        await graphFetch(instance, CAL_SCOPES, `${path}/decline`, { method: "POST", body: { sendResponse: true, comment: input.comment ?? "" }, immutableIds: false });
        try {
          await graphFetch(instance, CAL_SCOPES, path, { method: "DELETE", immutableIds: false });
        } catch (e) {
          if (!(e instanceof GraphError && e.status === 404)) throw e; // decline may already have removed it
        }
        return;
      }
      return graphFetch(instance, CAL_SCOPES, path, { method: "DELETE", immutableIds: false });
    },
    onMutate: (input) => {
      const snap = snapshot(qc);
      updateViews(qc, (l) => l.filter((ev) => ev.id !== input.id && ev.seriesMasterId !== input.id));
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast.error("Could not delete the event", { description: (e as Error).message });
    },
    onSettled: () => invalidate(),
  });

  const rsvp = useMutation({
    mutationFn: (input: { id: string; action: "accept" | "tentativelyAccept" | "decline"; comment?: string }) =>
      graphFetch(instance, CAL_SCOPES, `/me/events/${encodeURIComponent(input.id)}/${input.action}`, { method: "POST", body: { sendResponse: true, comment: input.comment ?? "" }, immutableIds: false }),
    onMutate: (input) => {
      const snap = snapshot(qc);
      const response = input.action === "accept" ? "accepted" : input.action === "decline" ? "declined" : "tentativelyAccepted";
      updateViews(qc, (l) => (input.action === "decline" ? l.filter((ev) => ev.id !== input.id) : l.map((ev) => (ev.id === input.id ? { ...ev, responseStatus: { response } } : ev))));
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      toast.error("Could not send your response", { description: (e as Error).message });
    },
    onSuccess: (_d, input) => toast.success(input.action === "accept" ? "Accepted" : input.action === "decline" ? "Declined" : "Marked as tentative"),
    onSettled: () => invalidate(),
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
      updateViews(qc, (l) => l.filter((ev) => ev.id !== input.id && ev.seriesMasterId !== input.id));
      let undone = false;
      const timer = setTimeout(() => {
        if (!undone) remove.mutate(input);
      }, 5000);
      toast(input.label ?? "Event deleted", {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            undone = true;
            clearTimeout(timer);
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
      const res = await graphFetch<{ value: ScheduleInformation[] }>(instance, ["Calendars.ReadWrite"], "/me/calendar/getSchedule", {
        method: "POST",
        immutableIds: false,
        headers: { Prefer: `outlook.timezone="${tz}"` },
        body: { schedules: list, startTime: { dateTime: `${day}T08:00:00`, timeZone: tz }, endTime: { dateTime: `${day}T20:00:00`, timeZone: tz }, availabilityViewInterval: 30 },
      });
      return res.value;
    },
  });
}

// ---------- reminders ----------

export function useReminders(tz: string, enabled: boolean) {
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
        const res = await graphFetch<{ value: Reminder[] }>(instance, CAL_SCOPES, path, { immutableIds: false });
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
                if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(r.eventSubject || "Reminder", { body: `Starts at ${when}` });
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
  }, [enabled, instance, tz]);
}
