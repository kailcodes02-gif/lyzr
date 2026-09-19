import { format } from "date-fns";
import { calendarHex, contrastText } from "./colors";
import { parseWall, toWallInZone, DAY } from "./time";
import type { CalEvent, GraphCalendar } from "./types";

// A Graph event normalised to wall time in the display zone.
export type WallEvent = CalEvent & { startWall: string; endWall: string };

export function normalise(ev: CalEvent, tz: string): WallEvent {
  return {
    ...ev,
    startWall: toWallInZone(ev.start, tz, !!ev.isAllDay),
    endWall: toWallInZone(ev.end, tz, !!ev.isAllDay),
  };
}

export type FcEventInput = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color: string;
  contrastColor: string;
  classNames: string[];
  editable: boolean;
  extendedProps: { ev: WallEvent };
};

// Shape FullCalendar consumes. Wall strings without an offset are read in the calendar's timeZone.
export function toFcEvent(ev: WallEvent, cal: GraphCalendar | undefined): FcEventInput {
  const hex = calendarHex(cal);
  const classNames = ["msui-ev"];
  if (ev.showAs === "tentative" || ev.responseStatus?.response === "tentativelyAccepted") classNames.push("msui-ev-tentative");
  if (ev.isCancelled) classNames.push("msui-ev-cancelled");
  if (ev.responseStatus?.response === "notResponded" || ev.responseStatus?.response === "none") classNames.push("msui-ev-invite");
  if (ev.showAs === "free") classNames.push("msui-ev-free");
  return {
    id: ev.id,
    title: ev.subject || "(No title)",
    start: ev.startWall,
    end: ev.endWall,
    allDay: !!ev.isAllDay,
    color: hex,
    contrastColor: contrastText(hex),
    classNames,
    editable: !!(cal?.canEdit ?? true) && !ev.isCancelled,
    extendedProps: { ev },
  };
}

// Client-side search over subject, location, attendee names and addresses.
export function matchesSearch(ev: WallEvent, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const hay = [
    ev.subject ?? "",
    ev.location?.displayName ?? "",
    ev.organizer?.emailAddress?.name ?? "",
    ev.organizer?.emailAddress?.address ?? "",
    ...(ev.attendees ?? []).flatMap((a) => [a.emailAddress.name ?? "", a.emailAddress.address ?? ""]),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(t);
}

export function sortEvents(list: WallEvent[]): WallEvent[] {
  return [...list].sort((a, b) => {
    if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
    return a.startWall < b.startWall ? -1 : a.startWall > b.startWall ? 1 : 0;
  });
}

// Agenda view: events grouped by calendar day, multi-day events on each day they touch.
export function groupByDay(list: WallEvent[], rangeStart: string, rangeEnd: string): { day: string; label: string; events: WallEvent[] }[] {
  const map = new Map<string, WallEvent[]>();
  for (const ev of sortEvents(list)) {
    const first = ev.startWall.slice(0, 10);
    let lastExclusive = ev.isAllDay ? ev.endWall.slice(0, 10) : ev.endWall.slice(0, 10);
    if (!ev.isAllDay && ev.endWall.slice(11) !== "00:00:00") lastExclusive = format(new Date(parseWall(lastExclusive).getTime() + 86_400_000), DAY);
    if (lastExclusive <= first) lastExclusive = format(new Date(parseWall(first).getTime() + 86_400_000), DAY);
    const d = parseWall(first);
    for (let k = format(d, DAY); k < lastExclusive; d.setDate(d.getDate() + 1), k = format(d, DAY)) {
      if (k < rangeStart || k >= rangeEnd) continue;
      const arr = map.get(k) ?? [];
      arr.push(ev);
      map.set(k, arr);
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, events]) => ({ day, label: format(parseWall(day), "EEE, MMM d"), events }));
}

// Dedupe by id (batched calendars can overlap when the same event lives in two lists).
export function dedupe(list: CalEvent[]): CalEvent[] {
  const seen = new Set<string>();
  return list.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}
