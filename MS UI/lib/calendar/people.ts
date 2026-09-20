"use client";

// Colleague overlays (localStorage list + getSchedule / shared calendarView
// fetches) and calendar groups. See overlay.ts for the pure mapping.
import { useMsal } from "@azure/msal-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { graphFetch, graphGetAll, GraphError, probeScopes } from "@/lib/graph";
import { isMockMode } from "@/lib/mock";
import { isPaletteColor, loadAssignedColors } from "./colors";
import { CAL_SCOPES, EVENT_SELECT, isConsentError } from "./hooks";
import { nextColor, scheduleItemsToEvents, sharedEventsToEvents, splitRange, type CalendarGroup, type Colleague, type ScheduleItem } from "./overlay";
import { wallToOffsetIso } from "./time";
import type { CalEvent, GraphCalendar, GraphEvent } from "./types";

export const PEOPLE_KEY = "msui.cal.people";
const SHARED_SCOPES = ["Calendars.Read.Shared"];

// Colours other calendars already use, so a new colleague gets a distinct one.
function calendarColorsTaken(): string[] {
  return Object.values(loadAssignedColors());
}

function loadColleagues(): Colleague[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PEOPLE_KEY) ?? "[]") as Colleague[];
    const list = Array.isArray(raw) ? raw.filter((p) => p && typeof p.email === "string") : [];
    // Colours from an older palette (blue-ish ones) are reassigned: blue is the user's.
    const taken = [...calendarColorsTaken(), ...list.map((p) => p.color).filter((c) => typeof c === "string" && isPaletteColor(c))];
    return list.map((p) => {
      if (typeof p.color === "string" && isPaletteColor(p.color)) return p;
      const color = nextColor(taken);
      taken.push(color);
      return { ...p, color };
    });
  } catch {
    return [];
  }
}
function saveColleagues(list: Colleague[]) {
  try {
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(list));
  } catch {
    // storage blocked
  }
}

export function useColleagues() {
  const [people, setPeople] = useState<Colleague[]>(() => (typeof window === "undefined" ? [] : loadColleagues()));
  const commit = useCallback((fn: (l: Colleague[]) => Colleague[]) => {
    setPeople((l) => {
      const next = fn(l);
      saveColleagues(next);
      return next;
    });
  }, []);
  const add = useCallback(
    (p: { email: string; name?: string }) =>
      commit((l) => {
        const email = p.email.trim().toLowerCase();
        if (!email || l.some((x) => x.email.toLowerCase() === email)) return l.map((x) => (x.email.toLowerCase() === email ? { ...x, hidden: false } : x));
        return [...l, { email, name: p.name?.trim() || p.email, color: nextColor([...l.map((x) => x.color), ...calendarColorsTaken()]), hidden: false }];
      }),
    [commit],
  );
  const remove = useCallback((email: string) => commit((l) => l.filter((x) => x.email.toLowerCase() !== email.toLowerCase())), [commit]);
  const toggle = useCallback((email: string) => commit((l) => l.map((x) => (x.email.toLowerCase() === email.toLowerCase() ? { ...x, hidden: !x.hidden } : x))), [commit]);
  const setColor = useCallback((email: string, color: string) => commit((l) => l.map((x) => (x.email.toLowerCase() === email.toLowerCase() ? { ...x, color } : x))), [commit]);
  const only = useCallback((email: string) => commit((l) => l.map((x) => ({ ...x, hidden: x.email.toLowerCase() !== email.toLowerCase() }))), [commit]);
  return { people, add, remove, toggle, setColor, only };
}

// ---------- calendar groups ----------

type GraphCalendarGroup = { id: string; name: string; classId?: string };

const GROUP_CAL_SELECT = "$select=id,name,color,hexColor,isDefaultCalendar,canEdit,canShare,owner,allowedOnlineMeetingProviders,defaultOnlineMeetingProvider";

export function useCalendarGroups() {
  const { instance, accounts } = useMsal();
  return useQuery({
    queryKey: ["calendarGroups", accounts[0]?.homeAccountId],
    enabled: accounts.length > 0 || isMockMode(),
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<CalendarGroup[]> => {
      const groups = await graphGetAll<GraphCalendarGroup>(instance, CAL_SCOPES, "/me/calendarGroups", 50, { immutableIds: false });
      const out: CalendarGroup[] = [];
      for (const g of groups) {
        try {
          const cals = await graphGetAll<GraphCalendar>(instance, CAL_SCOPES, `/me/calendarGroups/${encodeURIComponent(g.id)}/calendars?${GROUP_CAL_SELECT}`, 100, { immutableIds: false });
          out.push({ id: g.id, name: g.name, calendars: cals });
        } catch {
          out.push({ id: g.id, name: g.name, calendars: [] });
        }
      }
      return out;
    },
  });
}

// ---------- colleague schedules ----------

export type ColleagueResult = { person: Colleague; events: CalEvent[]; error?: string; source: "shared" | "schedule" | "none" };

type Instance = ReturnType<typeof useMsal>["instance"];

// Remembered per session so a 403 on /users/{upn}/calendarView is not retried every range.
const sharedDenied = new Set<string>();

// Whether Calendars.Read.Shared can be obtained silently is a per-app answer,
// not a per-colleague one: one memoised silent probe per session. An
// interactive token request would bounce the whole page to Entra, so the
// probe never escalates; anything but "granted" falls back to getSchedule.
let sharedProbe: Promise<boolean> | null = null;
function sharedScopeAvailable(instance: Instance): Promise<boolean> {
  if (isMockMode()) return Promise.resolve(true);
  if (!sharedProbe) {
    sharedProbe = probeScopes(instance, SHARED_SCOPES)
      .then((r) => r.state === "granted")
      .catch(() => false);
    // A transient failure ("unknown"/"reauth") is retried on the next session, not every range.
  }
  return sharedProbe;
}

// Test hook.
export function resetSharedProbe() {
  sharedProbe = null;
  sharedDenied.clear();
}

async function fetchShared(instance: Instance, person: Colleague, tz: string, start: string, end: string): Promise<CalEvent[] | null> {
  const key = person.email.toLowerCase();
  if (sharedDenied.has(key)) return null;
  if (!(await sharedScopeAvailable(instance))) return null;
  const startIso = encodeURIComponent(wallToOffsetIso(start, tz));
  const endIso = encodeURIComponent(wallToOffsetIso(end, tz));
  try {
    const list = await graphGetAll<GraphEvent>(
      instance,
      SHARED_SCOPES,
      `/users/${encodeURIComponent(person.email)}/calendarView?startDateTime=${startIso}&endDateTime=${endIso}&${EVENT_SELECT}&$top=500`,
      2000,
      { immutableIds: false, headers: { Prefer: `outlook.timezone="${tz}"` } },
    );
    return sharedEventsToEvents(person, list.map((e) => ({ ...e, calendarId: "" })));
  } catch (e) {
    // No Calendars.Read.Shared, calendar not shared with details, unknown or external user
    // (400 ErrorInvalidUser): any 4xx is final for this person this session; 5xx retries next range.
    if (isConsentError(e) || (e instanceof GraphError && e.status >= 400 && e.status < 500)) sharedDenied.add(key);
    return null;
  }
}

async function fetchSchedules(instance: Instance, people: Colleague[], tz: string, start: string, end: string): Promise<Map<string, { items: ScheduleItem[]; error?: string }>> {
  const out = new Map<string, { items: ScheduleItem[]; error?: string }>();
  const chunks = splitRange(`${start}T00:00:00`, `${end}T00:00:00`);
  for (let i = 0; i < people.length; i += 20) {
    const batch = people.slice(i, i + 20);
    for (const r of chunks) {
      const res = await graphFetch<{ value: { scheduleId: string; scheduleItems?: ScheduleItem[]; error?: { message?: string; responseCode?: string } }[] }>(instance, CAL_SCOPES, "/me/calendar/getSchedule", {
        method: "POST",
        immutableIds: false,
        headers: { Prefer: `outlook.timezone="${tz}"` },
        body: { schedules: batch.map((p) => p.email), startTime: { dateTime: r.start, timeZone: tz }, endTime: { dateTime: r.end, timeZone: tz }, availabilityViewInterval: 30 },
      });
      for (const s of res.value ?? []) {
        const key = s.scheduleId.toLowerCase();
        const cur = out.get(key) ?? { items: [] };
        cur.items.push(...(s.scheduleItems ?? []));
        if (s.error) cur.error = s.error.message || s.error.responseCode || "Could not read this calendar";
        out.set(key, cur);
      }
    }
  }
  return out;
}

// Stable combine so useQueries hands back a structurally-shared result (no new array per render).
function combineShared(results: { data?: CalEvent[] | null; isFetching: boolean }[]) {
  return { data: results.map((r) => r.data ?? null), fetching: results.some((r) => r.isFetching) };
}

export function useColleagueSchedules(tz: string, range: { start: string; end: string }, people: Colleague[]) {
  const { instance } = useMsal();
  const enabled = useMemo(() => people.filter((p) => !p.hidden), [people]);
  const emails = enabled.map((p) => p.email.toLowerCase()).sort().join(",");
  // One query for all free/busy (getSchedule takes up to 20 people per call)...
  const schedule = useQuery({
    queryKey: ["colleagueSchedule", tz, range.start, range.end, emails],
    enabled: enabled.length > 0,
    staleTime: 60_000,
    retry: false,
    placeholderData: (prev) => prev,
    queryFn: () => fetchSchedules(instance, enabled, tz, range.start, range.end),
  });
  // ...and one per person for a shared calendar with full details (preferred when it works).
  const shared = useQueries({
    queries: enabled.map((p) => ({
      queryKey: ["colleagueShared", tz, range.start, range.end, p.email.toLowerCase()],
      staleTime: 60_000,
      retry: false,
      queryFn: () => fetchShared(instance, p, tz, range.start, range.end),
    })),
    combine: combineShared,
  });
  const results = useMemo<ColleagueResult[]>(
    () =>
      enabled.map((p, i) => {
        const key = p.email.toLowerCase();
        const sh = shared.data[i];
        if (sh && sh.length) return { person: p, events: sh, source: "shared" };
        const s = schedule.data?.get(key);
        if (!s) return { person: p, events: [], source: "none", error: schedule.error ? (schedule.error as Error).message : undefined };
        return { person: p, events: scheduleItemsToEvents(p, s.items, tz), source: "schedule", error: s.error };
      }),
    [enabled, shared.data, schedule.data, schedule.error, tz],
  );
  const events = useMemo(() => results.flatMap((r) => r.events), [results]);
  const errors = useMemo(() => new Map(results.filter((r) => r.error).map((r) => [r.person.email.toLowerCase(), r.error!])), [results]);
  return { events, errors, results, isFetching: schedule.isFetching || shared.fetching };
}
