import { addDays, format } from "date-fns";
import { calendarHex, contrastText } from "./colors";
import { initials } from "./overlay";
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

export type FcPerson = { name: string; email: string; color: string; initials: string };

// How a chip is drawn (grid.tsx renders it, calendar.css styles it):
//   block  time-grid block: the title only (the axis shows the time), wrapping
//          over as many lines as the block allows, in the computed contrast colour
//   dot    month view, timed event: colour dot + title, no time
//   row    all-day chips (month rows, the all-day lane): single line, solid colour
export type ChipKind = "block" | "dot" | "row";
export function chipKind(viewType: string, allDay: boolean): ChipKind {
  if (viewType.startsWith("timeGrid")) return allDay ? "row" : "block";
  return allDay ? "row" : "dot";
}
export function chipOuterClass(kind: ChipKind): string {
  return kind === "dot" ? "msui-ev-dot-event" : "msui-ev-solid";
}

// Timed events of 15 minutes or less get one 11 px line for the title.
export const SHORT_EVENT_MINUTES = 15;

export function durationMinutes(ev: Pick<WallEvent, "startWall" | "endWall">): number {
  const s = parseWall(ev.startWall).getTime();
  const e = parseWall(ev.endWall).getTime();
  return Number.isFinite(s) && Number.isFinite(e) ? Math.round((e - s) / 60_000) : 0;
}

export function isShortEvent(ev: Pick<WallEvent, "startWall" | "endWall" | "isAllDay">): boolean {
  return !ev.isAllDay && durationMinutes(ev) <= SHORT_EVENT_MINUTES;
}

export type FcEventInput = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color: string;
  contrastColor: string;
  // FullCalendar v7: a single space-joined string (arrays are rejected, `classNames` is not a known key).
  className: string;
  editable: boolean;
  extendedProps: { ev: WallEvent; person?: FcPerson };
};

// Shape FullCalendar consumes. Wall strings without an offset are read in the
// calendar's timeZone. `hex` is the resolved chip colour (blue for calendars
// the user owns, a palette colour otherwise); it falls back to the Outlook
// calendar colour when the caller has none.
export function toFcEvent(ev: WallEvent, cal: GraphCalendar | undefined, hex: string = calendarHex(cal)): FcEventInput {
  const classNames = ["msui-ev"];
  if (ev.showAs === "tentative" || ev.responseStatus?.response === "tentativelyAccepted") classNames.push("msui-ev-tentative");
  if (ev.isCancelled) classNames.push("msui-ev-cancelled");
  if (ev.responseStatus?.response === "notResponded" || ev.responseStatus?.response === "none") classNames.push("msui-ev-invite");
  if (ev.showAs === "free") classNames.push("msui-ev-free");
  if (isShortEvent(ev)) classNames.push("msui-ev-short");
  return {
    id: ev.id,
    title: ev.subject || "(No title)",
    start: ev.startWall,
    end: ev.endWall,
    allDay: !!ev.isAllDay,
    color: hex,
    contrastColor: contrastText(hex),
    className: classNames.join(" "),
    editable: !!(cal?.canEdit ?? true) && !ev.isCancelled,
    extendedProps: { ev },
  };
}

// A colleague's overlay event: their colour, translucent, read-only, initials prefix.
export function toFcPersonEvent(ev: WallEvent, person: { name: string; email: string; color: string }): FcEventInput {
  const classNames = ["msui-ev", "msui-ev-colleague"];
  if (ev.showAs === "tentative") classNames.push("msui-ev-tentative");
  if (ev.showAs === "oof") classNames.push("msui-ev-oof");
  if (isShortEvent(ev)) classNames.push("msui-ev-short");
  return {
    id: ev.id,
    title: ev.subject || "Busy",
    start: ev.startWall,
    end: ev.endWall,
    allDay: !!ev.isAllDay,
    color: person.color,
    contrastColor: contrastText(person.color),
    className: classNames.join(" "),
    editable: false,
    extendedProps: { ev, person: { name: person.name, email: person.email, color: person.color, initials: initials(person.name) } },
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
    // Calendar-day arithmetic (addDays), not +24 h: on the DST fall-back day 24 h of wall
    // milliseconds lands at 23:00 the same day and the loop below would never run.
    if (!ev.isAllDay && ev.endWall.slice(11) !== "00:00:00") lastExclusive = format(addDays(parseWall(lastExclusive), 1), DAY);
    if (lastExclusive <= first) lastExclusive = format(addDays(parseWall(first), 1), DAY);
    let d = parseWall(first);
    for (let k = format(d, DAY); k < lastExclusive; d = addDays(d, 1), k = format(d, DAY)) {
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
