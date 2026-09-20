// Colleague calendar overlays (Google's "Other calendars" for people) and the
// My / Other grouping of the calendar list. Pure functions; hooks live in people.ts.
import { contrastText, OTHER_PALETTE, pickColor } from "./colors";
import { toWallInZone } from "./time";
import type { CalEvent, GraphCalendar, ShowAs } from "./types";

export type Colleague = { email: string; name: string; color: string; hidden?: boolean };

// Google-ish palette for people you subscribe to: the same non-blue palette
// as other calendars (blue is reserved for the user's own events), assigned
// in order of appearance and kept per person.
export const PERSON_COLORS = OTHER_PALETTE;

export function nextColor(taken: string[]): string {
  return pickColor(taken);
}

export const PEOPLE_PREFIX = "people:";
export const isColleagueCalendar = (calendarId: string) => calendarId.startsWith(PEOPLE_PREFIX);
export const colleagueCalendarId = (email: string) => `${PEOPLE_PREFIX}${email.toLowerCase()}`;

// scheduleItem as returned by POST /me/calendar/getSchedule.
export type ScheduleItem = {
  status?: ShowAs | string;
  subject?: string;
  location?: string;
  isPrivate?: boolean;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
};

export const STATUS_LABEL: Record<string, string> = {
  busy: "Busy",
  tentative: "Tentative",
  oof: "Out of office",
  workingElsewhere: "Working elsewhere",
  unknown: "Busy",
};

export function statusLabel(status: string | undefined): string {
  return STATUS_LABEL[status ?? "busy"] ?? "Busy";
}

// getSchedule caps a request at 62 days; split longer ranges into consecutive chunks.
// Inputs/outputs are wall strings "YYYY-MM-DDTHH:mm:ss" (end exclusive).
export function splitRange(start: string, end: string, maxDays = 62): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  const s = new Date(`${start.slice(0, 19)}Z`);
  const e = new Date(`${end.slice(0, 19)}Z`);
  if (!(e > s)) return [];
  let cur = s;
  while (cur < e) {
    const next = new Date(Math.min(cur.getTime() + maxDays * 86_400_000, e.getTime()));
    out.push({ start: cur.toISOString().slice(0, 19), end: next.toISOString().slice(0, 19) });
    cur = next;
  }
  return out;
}

// One colleague's scheduleItems -> read-only CalEvents (free slots are dropped).
export function scheduleItemsToEvents(person: Colleague, items: ScheduleItem[], tz: string): CalEvent[] {
  const out: CalEvent[] = [];
  for (const [i, it] of items.entries()) {
    const status = (it.status ?? "busy") as ShowAs;
    if (status === "free") continue;
    const start = { dateTime: it.start.dateTime.replace(/\.\d+$/, ""), timeZone: it.start.timeZone || "UTC" };
    const end = { dateTime: it.end.dateTime.replace(/\.\d+$/, ""), timeZone: it.end.timeZone || "UTC" };
    const subject = it.subject && !it.isPrivate ? it.subject : statusLabel(status);
    out.push({
      // The index keeps overlapping items (double bookings, busy + tentative on the same slot) distinct.
      id: `sched:${person.email.toLowerCase()}:${toWallInZone(start, tz)}:${toWallInZone(end, tz)}:${i}`,
      calendarId: colleagueCalendarId(person.email),
      subject,
      start,
      end,
      isAllDay: false,
      showAs: status,
      sensitivity: it.isPrivate ? "private" : "normal",
      location: it.location ? { displayName: it.location } : undefined,
      organizer: { emailAddress: { name: person.name, address: person.email } },
      attendees: [],
      type: "singleInstance",
      isOrganizer: false,
    });
  }
  return out;
}

// A colleague's calendarView events (shared with details) re-tagged onto their overlay calendar.
export function sharedEventsToEvents(person: Colleague, events: CalEvent[] | Omit<CalEvent, "calendarId">[]): CalEvent[] {
  return events.map((e) => ({ ...e, calendarId: colleagueCalendarId(person.email), id: `shared:${person.email.toLowerCase()}:${e.id}` }));
}

export function personStyle(color: string) {
  return { color, contrastColor: contrastText(color) };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// ---------- My calendars vs Other calendars ----------

export type CalendarGroup = { id: string; name: string; calendars: GraphCalendar[] };
export type OtherCalendar = { cal: GraphCalendar; groupId?: string; groupName: string; ownerName: string };

// "Mine": from /me/calendars, the default one or owned by the signed-in user.
// "Other": calendars in /me/calendars owned by somebody else (shared to me),
// plus calendars in any other calendar group, labelled with group + owner.
//
// Ownership: canShare (true only for the creator, address-independent) first;
// then the owner address against every address we know for the user: the UPN
// (accounts[0].username) and the default calendar's owner (the primary SMTP,
// which differs from the UPN in tenants with alias domains).
export function groupCalendars(mine: GraphCalendar[], groups: CalendarGroup[], me: string | undefined): { mine: GraphCalendar[]; other: OtherCalendar[] } {
  const self = new Set<string>();
  for (const a of [me, mine.find((c) => c.isDefaultCalendar)?.owner?.address, ...groups.flatMap((g) => g.calendars.filter((c) => c.isDefaultCalendar).map((c) => c.owner?.address))]) {
    if (a) self.add(a.toLowerCase());
  }
  const isSelf = (address?: string) => !!address && self.has(address.toLowerCase());
  const owned = (c: GraphCalendar, allowUnknownOwner: boolean) => {
    if (c.isDefaultCalendar) return true;
    if (c.canShare === true) return true;
    if (c.canShare === false) return isSelf(c.owner?.address);
    if (!c.owner?.address) return allowUnknownOwner;
    return isSelf(c.owner.address);
  };
  const myList: GraphCalendar[] = [];
  const other: OtherCalendar[] = [];
  const seen = new Set<string>();
  for (const c of mine) {
    seen.add(c.id);
    if (owned(c, true)) myList.push(c);
    else other.push({ cal: c, groupName: "Shared with me", ownerName: c.owner?.name || c.owner?.address || "" });
  }
  for (const g of groups) {
    const isDefaultGroup = g.calendars.some((c) => c.isDefaultCalendar) || /^my calendars$/i.test(g.name);
    for (const c of g.calendars) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      if (isDefaultGroup && owned(c, false)) myList.push(c);
      else other.push({ cal: c, groupId: g.id, groupName: g.name, ownerName: c.owner?.name || c.owner?.address || "" });
    }
  }
  return { mine: myList, other };
}
