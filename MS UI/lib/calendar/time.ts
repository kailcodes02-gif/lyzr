import { addDays, addMinutes, differenceInCalendarDays, endOfMonth, format, parse, startOfMonth, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { DateTimeTimeZone, ViewKind } from "./types";

export const WALL = "yyyy-MM-dd'T'HH:mm:ss";
export const DAY = "yyyy-MM-dd";

export function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Wall-clock string (no offset) parsed as a plain local Date for arithmetic.
// Used only for calendar math on the wall time; never for instants.
export function parseWall(s: string): Date {
  const clean = s.replace(/\.\d+$/, "").replace(/(Z|[+-]\d{2}:\d{2})$/, "");
  if (clean.length <= 10) return parse(clean, DAY, new Date());
  const t = clean.slice(0, 19);
  return parse(t.length === 16 ? `${t}:00` : t, WALL, new Date());
}

export function formatWall(d: Date): string {
  return format(d, WALL);
}

// Graph gives 7 fractional digits ("2026-09-20T10:00:00.0000000"); trim to seconds.
export function trimGraphDateTime(s: string): string {
  return s.replace(/\.\d+$/, "").slice(0, 19);
}

// Convert a Graph dateTimeTimeZone to wall time in the display zone.
// If the value is already in that zone (Prefer: outlook.timezone honoured) it is passed through.
export function toWallInZone(dt: DateTimeTimeZone, tz: string, allDay = false): string {
  const raw = trimGraphDateTime(dt.dateTime);
  if (allDay) return raw.slice(0, 10);
  const src = dt.timeZone === "tzone://Microsoft/Custom" ? tz : dt.timeZone || "UTC";
  if (src === tz) return raw;
  if (!isValidTimeZone(src)) return raw; // Windows zone name without the Prefer header; best effort
  const instant = fromZonedTime(raw, src);
  return formatInTimeZone(instant, tz, WALL);
}

// Wall time in zone -> ISO 8601 with offset (for calendarView query params).
export function wallToOffsetIso(wall: string, tz: string): string {
  const instant = fromZonedTime(wall.length <= 10 ? `${wall}T00:00:00` : wall, tz);
  return formatInTimeZone(instant, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

export function wallToInstant(wall: string, tz: string): Date {
  return fromZonedTime(wall.length <= 10 ? `${wall}T00:00:00` : wall, tz);
}

export function instantToWall(d: Date, tz: string): string {
  return formatInTimeZone(d, tz, WALL);
}

export function nowWall(tz: string): string {
  return instantToWall(new Date(), tz);
}

// All-day events: Graph uses date-only exclusive end ("2026-09-22" for a one-day event on the 21st).
export function allDayInclusiveEnd(exclusiveEnd: string): string {
  return format(addDays(parseWall(exclusiveEnd.slice(0, 10)), -1), DAY);
}
export function allDayExclusiveEnd(inclusiveEnd: string): string {
  return format(addDays(parseWall(inclusiveEnd.slice(0, 10)), 1), DAY);
}
export function allDaySpanDays(start: string, exclusiveEnd: string): number {
  return Math.max(1, differenceInCalendarDays(parseWall(exclusiveEnd.slice(0, 10)), parseWall(start.slice(0, 10))));
}

// Visible range for a view, as wall dates in the display zone. End is exclusive.
export function visibleRange(view: ViewKind, dateStr: string, weekStartsOn: 0 | 1 | 6): { start: string; end: string } {
  const d = parseWall(dateStr);
  switch (view) {
    case "day":
      return { start: format(d, DAY), end: format(addDays(d, 1), DAY) };
    case "4day":
      return { start: format(d, DAY), end: format(addDays(d, 4), DAY) };
    case "week": {
      const s = startOfWeek(d, { weekStartsOn });
      return { start: format(s, DAY), end: format(addDays(s, 7), DAY) };
    }
    case "agenda": {
      return { start: format(d, DAY), end: format(addDays(d, 30), DAY) };
    }
    case "month":
    default: {
      const s = startOfWeek(startOfMonth(d), { weekStartsOn });
      const e = addDays(startOfWeek(endOfMonth(d), { weekStartsOn }), 7);
      return { start: format(s, DAY), end: format(e, DAY) };
    }
  }
}

// Step the anchor date forwards or backwards by one view unit.
export function stepDate(view: ViewKind, dateStr: string, dir: 1 | -1): string {
  const d = parseWall(dateStr);
  switch (view) {
    case "day":
      return format(addDays(d, dir), DAY);
    case "4day":
      return format(addDays(d, 4 * dir), DAY);
    case "week":
      return format(addDays(d, 7 * dir), DAY);
    case "agenda":
      return format(addDays(d, 30 * dir), DAY);
    case "month":
    default: {
      const m = startOfMonth(d);
      m.setMonth(m.getMonth() + dir);
      return format(m, DAY);
    }
  }
}

export function rangeTitle(view: ViewKind, dateStr: string, weekStartsOn: 0 | 1 | 6): string {
  const { start, end } = visibleRange(view, dateStr, weekStartsOn);
  const s = parseWall(start);
  const e = addDays(parseWall(end), -1);
  if (view === "month") return format(parseWall(dateStr), "MMMM yyyy");
  if (view === "day") return format(s, "EEEE, MMMM d, yyyy");
  if (s.getMonth() === e.getMonth()) return `${format(s, "MMMM")} ${format(s, "d")} to ${format(e, "d")}, ${format(e, "yyyy")}`;
  if (s.getFullYear() === e.getFullYear()) return `${format(s, "MMM d")} to ${format(e, "MMM d")}, ${format(e, "yyyy")}`;
  return `${format(s, "MMM d, yyyy")} to ${format(e, "MMM d, yyyy")}`;
}

export function formatTimeRange(startWall: string, endWall: string, allDay: boolean): string {
  if (allDay) {
    const s = parseWall(startWall);
    const e = parseWall(allDayInclusiveEnd(endWall));
    if (differenceInCalendarDays(e, s) <= 0) return format(s, "EEEE, MMMM d");
    return `${format(s, "MMM d")} to ${format(e, "MMM d")}`;
  }
  const s = parseWall(startWall);
  const e = parseWall(endWall);
  const sameDay = differenceInCalendarDays(e, s) === 0;
  const t = (d: Date) => format(d, d.getMinutes() ? "h:mm a" : "h a").toLowerCase();
  return sameDay ? `${format(s, "EEEE, MMMM d")} ${t(s)} to ${t(e)}` : `${format(s, "MMM d, h:mm a")} to ${format(e, "MMM d, h:mm a")}`;
}

export function shortTime(wall: string): string {
  const d = parseWall(wall);
  return format(d, d.getMinutes() ? "h:mm a" : "h a").toLowerCase();
}

export function roundToNext(minutes: number, wall: string): string {
  const d = parseWall(wall);
  const m = d.getMinutes();
  const r = m % minutes === 0 ? m : m + (minutes - (m % minutes));
  d.setMinutes(r, 0, 0);
  return formatWall(d);
}

export function addMinutesWall(wall: string, minutes: number): string {
  return formatWall(addMinutes(parseWall(wall), minutes));
}

export function todayStr(tz: string): string {
  return formatInTimeZone(new Date(), tz, DAY);
}
