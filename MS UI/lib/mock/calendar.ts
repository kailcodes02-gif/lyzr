import type { MockHandler } from "./index";
import type { Attendee, DayOfWeek, GraphCalendar, GraphEvent, PatternedRecurrence, ResponseType } from "@/lib/calendar/types";

// Mock Graph data for calendar. In-memory state so create / move / delete are
// reflected on re-fetch. Fixtures are relative to "now" so the demo always has
// events on screen. Times are stored as UTC and returned with timeZone "UTC";
// the client converts to the display zone.

const ME = { name: "Kailash G M", address: "kailash.gm@lyzr.com" };
const PEOPLE = {
  siva: { name: "Siva Surendira", address: "siva@lyzr.ai" },
  anirudh: { name: "Anirudh Narayan", address: "anirudh@lyzr.ai" },
  priya: { name: "Priya Raman", address: "priya.raman@accenture.com" },
  daniel: { name: "Daniel Okafor", address: "daniel.okafor@infosys.com" },
  mei: { name: "Mei Chen", address: "mei.chen@wipro.com" },
  rahul: { name: "Rahul Verma", address: "rahul.verma@tcs.com" },
  sofia: { name: "Sofia Alvarez", address: "sofia.alvarez@capgemini.com" },
  james: { name: "James Whitfield", address: "james.whitfield@deloitte.com" },
  neha: { name: "Neha Iyer", address: "neha.iyer@hcltech.com" },
  tom: { name: "Tom Becker", address: "tom.becker@cognizant.com" },
};

export const MOCK_CALENDARS: GraphCalendar[] = [
  {
    id: "cal-default",
    name: "Calendar",
    color: "auto",
    hexColor: "",
    isDefaultCalendar: true,
    canEdit: true,
    owner: ME,
    allowedOnlineMeetingProviders: ["teamsForBusiness"],
    defaultOnlineMeetingProvider: "teamsForBusiness",
  },
  {
    id: "cal-gsi",
    name: "GSI Events",
    color: "lightGreen",
    hexColor: "",
    isDefaultCalendar: false,
    canEdit: true,
    owner: ME,
    allowedOnlineMeetingProviders: [],
    defaultOnlineMeetingProvider: "unknown",
  },
];

type StoredEvent = GraphEvent & { calendarId: string; originalStart?: string; deletedOccurrences?: string[] };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ymdUtc = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// Local wall time (the machine running the demo) -> Graph UTC dateTime.
function utc(d: Date): { dateTime: string; timeZone: string } {
  return { dateTime: d.toISOString().replace("Z", "0000"), timeZone: "UTC" };
}
function dateOnly(d: Date): { dateTime: string; timeZone: string } {
  return { dateTime: `${ymd(d)}T00:00:00.0000000`, timeZone: "UTC" };
}
function at(dayOffset: number, h: number, m = 0): Date {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  return d;
}
function plusMin(d: Date, min: number): Date {
  return new Date(d.getTime() + min * 60_000);
}

function att(p: { name: string; address: string }, response: ResponseType = "accepted", type: Attendee["type"] = "required"): Attendee {
  return { type, status: { response, time: "0001-01-01T00:00:00Z" }, emailAddress: p };
}

let seq = 100;
const nid = () => `evt-${++seq}`;

type MkInput = Omit<Partial<StoredEvent>, "start" | "end"> & { subject: string; start: Date; end: Date; calendarId?: string };
function mk(o: MkInput): StoredEvent {
  const { start, end, ...rest } = o;
  const id = rest.id ?? nid();
  const organizer = rest.organizer ?? { emailAddress: ME };
  const mine = organizer.emailAddress.address === ME.address;
  return {
    id,
    calendarId: rest.calendarId ?? "cal-default",
    type: "singleInstance",
    isAllDay: false,
    showAs: "busy",
    sensitivity: "normal",
    importance: "normal",
    categories: [],
    isOnlineMeeting: false,
    onlineMeeting: null,
    onlineMeetingProvider: "unknown",
    seriesMasterId: null,
    recurrence: null,
    isCancelled: false,
    isReminderOn: true,
    reminderMinutesBeforeStart: 15,
    isOrganizer: mine,
    responseStatus: { response: mine ? "organizer" : "accepted", time: "0001-01-01T00:00:00Z" },
    webLink: `https://outlook.office365.com/calendar/item/${id}`,
    bodyPreview: rest.body?.content ?? "",
    body: { contentType: "text", content: "" },
    attendees: [],
    location: { displayName: "" },
    ...rest,
    organizer,
    start: rest.isAllDay ? dateOnly(start) : utc(start),
    end: rest.isAllDay ? dateOnly(end) : utc(end),
  };
}

function teams(id: string) {
  return { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" as const, onlineMeeting: { joinUrl: `https://teams.microsoft.com/l/meetup-join/mock/${id}` } };
}

function seed(): StoredEvent[] {
  const dow = new Date().getDay();
  const toMonday = ((1 - dow + 7) % 7) - (dow === 1 ? 0 : 7); // most recent Monday (0 or negative offset)
  const list: StoredEvent[] = [];
  const body = (s: string) => ({ body: { contentType: "text" as const, content: s }, bodyPreview: s });

  // Weekly recurring series: GSI weekly sync every Tuesday 10:00, started 8 weeks ago.
  const syncStart = at(toMonday + 1 - 56, 10, 0);
  const seriesRec: PatternedRecurrence = {
    pattern: { type: "weekly", interval: 1, daysOfWeek: ["tuesday"], firstDayOfWeek: "sunday" },
    range: { type: "noEnd", startDate: ymd(syncStart), recurrenceTimeZone: "UTC" },
  };
  list.push(
    mk({
      id: "evt-sync",
      subject: "GSI weekly sync",
      start: syncStart,
      end: plusMin(syncStart, 45),
      type: "seriesMaster",
      recurrence: seriesRec,
      attendees: [att(PEOPLE.siva), att(PEOPLE.anirudh, "tentativelyAccepted")],
      ...teams("evt-sync"),
      ...body("Pipeline review across Accenture, Infosys, Wipro, TCS. Bring the weekly report."),
    }),
  );
  // One exception: this week's sync moved to 11:30 with a room.
  const exDate = at(toMonday + 1, 10, 0);
  list.push(
    mk({
      id: "evt-sync-exception",
      subject: "GSI weekly sync (moved)",
      start: at(toMonday + 1, 11, 30),
      end: at(toMonday + 1, 12, 15),
      type: "exception",
      seriesMasterId: "evt-sync",
      originalStart: ymd(exDate),
      location: { displayName: "Chennai office, Bay 4" },
      attendees: [att(PEOPLE.siva), att(PEOPLE.anirudh, "accepted")],
      ...teams("evt-sync"),
      ...body("Moved to make room for the Accenture QBR prep."),
    }),
  );
  // Daily standup, weekdays, ends after 40 occurrences.
  const standupStart = at(toMonday - 21, 9, 15);
  list.push(
    mk({
      id: "evt-standup",
      subject: "Marketing standup",
      start: standupStart,
      end: plusMin(standupStart, 15),
      type: "seriesMaster",
      recurrence: {
        pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"], firstDayOfWeek: "sunday" },
        range: { type: "numbered", startDate: ymd(standupStart), numberOfOccurrences: 40, recurrenceTimeZone: "UTC" },
      },
      attendees: [att(PEOPLE.siva), att(PEOPLE.anirudh)],
      showAs: "busy",
      reminderMinutesBeforeStart: 5,
      ...body("What shipped, what is blocked, what needs Siva."),
    }),
  );

  const singles: MkInput[] = [
    { subject: "Accenture QBR prep", start: at(toMonday, 14, 0), end: at(toMonday, 15, 0), attendees: [att(PEOPLE.priya, "accepted"), att(PEOPLE.siva)], location: { displayName: "Teams" }, ...teams("qbr"), ...body("Slides: GSI partner deck v7, Q3 pipeline numbers.") },
    { subject: "Infosys co-marketing kickoff", start: at(toMonday + 2, 11, 0), end: at(toMonday + 2, 12, 0), organizer: { emailAddress: PEOPLE.daniel }, attendees: [att(PEOPLE.daniel, "organizer"), att(ME, "notResponded"), att(PEOPLE.anirudh, "accepted")], responseStatus: { response: "notResponded" }, ...teams("infosys"), ...body("Agenda: joint webinar dates, Lyzr Agent Studio positioning, MDF budget.") },
    { subject: "Wipro partner enablement session", start: at(toMonday + 2, 15, 30), end: at(toMonday + 2, 16, 30), organizer: { emailAddress: PEOPLE.mei }, attendees: [att(PEOPLE.mei, "organizer"), att(ME, "tentativelyAccepted")], responseStatus: { response: "tentativelyAccepted" }, showAs: "tentative", ...body("Optional. Deck: Wipro enablement 101.") },
    { subject: "Weekly GSI report due", start: at(toMonday + 4, 0, 0), end: at(toMonday + 5, 0, 0), isAllDay: true, showAs: "free", calendarId: "cal-gsi", ...body("Publish the GSI/SI marketing tracker report to #gsi-marketing.") },
    { subject: "1:1 with Siva", start: at(toMonday + 3, 16, 0), end: at(toMonday + 3, 16, 30), attendees: [att(PEOPLE.siva)], ...body("Headcount ask, LinkedIn campaign results.") },
    { subject: "Performance review notes", start: at(toMonday + 3, 13, 0), end: at(toMonday + 3, 13, 30), sensitivity: "private", ...body("Private.") },
    { subject: "TCS Agentic AI webinar dry run", start: at(toMonday + 7, 10, 0), end: at(toMonday + 7, 11, 0), calendarId: "cal-gsi", attendees: [att(PEOPLE.rahul, "accepted"), att(PEOPLE.anirudh, "declined")], ...teams("tcs"), ...body("Run through the 'Agents at scale' deck; check the polls.") },
    { subject: "Capgemini partner summit", start: at(toMonday + 9, 0, 0), end: at(toMonday + 11, 0, 0), isAllDay: true, calendarId: "cal-gsi", location: { displayName: "Paris" }, attendees: [att(PEOPLE.sofia)], ...body("Booth 12. Bring the GSI partner brochure.") },
    { subject: "Deloitte alliance review", start: at(toMonday + 8, 14, 0), end: at(toMonday + 8, 15, 0), organizer: { emailAddress: PEOPLE.james }, attendees: [att(PEOPLE.james, "organizer"), att(ME, "accepted")], ...teams("deloitte") },
    { subject: "Campaign deck review: HCLTech launch", start: at(toMonday + 10, 11, 0), end: at(toMonday + 10, 12, 0), attendees: [att(PEOPLE.neha, "accepted"), att(PEOPLE.siva, "tentativelyAccepted")], calendarId: "cal-gsi", ...body("v3 of the HCLTech launch deck; align on the CTA.") },
    { subject: "Cognizant intro call", start: at(toMonday + 11, 9, 30), end: at(toMonday + 11, 10, 0), organizer: { emailAddress: PEOPLE.tom }, attendees: [att(PEOPLE.tom, "organizer"), att(ME, "notResponded")], responseStatus: { response: "notResponded" }, ...teams("cognizant") },
    { subject: "Lunch", start: at(toMonday + 1, 13, 0), end: at(toMonday + 1, 14, 0), showAs: "free", isReminderOn: false },
    { subject: "Focus: GSI newsletter draft", start: at(toMonday + 4, 9, 0), end: at(toMonday + 4, 11, 0), showAs: "workingElsewhere", ...body("September issue: Accenture case study, Infosys webinar recap.") },
    { subject: "Cancelled: Wipro roadmap sync", start: at(toMonday + 5, 10, 0), end: at(toMonday + 5, 11, 0), isCancelled: true, organizer: { emailAddress: PEOPLE.mei }, attendees: [att(PEOPLE.mei, "organizer"), att(ME, "accepted")] },
    { subject: "Board deck: GSI pipeline slide", start: at(toMonday + 14, 15, 0), end: at(toMonday + 14, 16, 0), attendees: [att(PEOPLE.siva)] },
    { subject: "Infosys webinar: Agents in the enterprise", start: at(toMonday + 16, 16, 0), end: at(toMonday + 16, 17, 0), calendarId: "cal-gsi", attendees: [att(PEOPLE.daniel, "accepted"), att(PEOPLE.anirudh, "accepted")], ...teams("infosys-webinar"), ...body("Live webinar. Host: Daniel. Co-host: Kailash.") },
    { subject: "Accenture case study interview", start: at(toMonday + 17, 11, 0), end: at(toMonday + 17, 11, 45), attendees: [att(PEOPLE.priya, "accepted")], ...teams("acc-case") },
    { subject: "Quarterly GSI report", start: at(toMonday + 21, 0, 0), end: at(toMonday + 22, 0, 0), isAllDay: true, calendarId: "cal-gsi", showAs: "free" },
    { subject: "Dentist", start: at(toMonday + 12, 8, 0), end: at(toMonday + 12, 9, 0), sensitivity: "private", showAs: "oof" },
    { subject: "TCS partner day", start: at(toMonday + 23, 0, 0), end: at(toMonday + 24, 0, 0), isAllDay: true, calendarId: "cal-gsi", location: { displayName: "Mumbai" }, attendees: [att(PEOPLE.rahul)] },
    { subject: "Wipro webinar follow-ups", start: at(toMonday + 24, 14, 0), end: at(toMonday + 24, 15, 0), calendarId: "cal-gsi", attendees: [att(PEOPLE.mei, "tentativelyAccepted")] },
    { subject: "Capgemini deal desk", start: at(toMonday + 28, 10, 0), end: at(toMonday + 28, 11, 0), organizer: { emailAddress: PEOPLE.sofia }, attendees: [att(PEOPLE.sofia, "organizer"), att(ME, "accepted")], ...teams("cap-deal") },
    { subject: "Marketing all-hands", start: at(toMonday + 30, 17, 0), end: at(toMonday + 30, 18, 0), attendees: [att(PEOPLE.siva), att(PEOPLE.anirudh)], ...teams("all-hands") },
    { subject: "Deloitte co-sell playbook", start: at(toMonday + 31, 13, 0), end: at(toMonday + 31, 14, 30), attendees: [att(PEOPLE.james, "notResponded")], calendarId: "cal-gsi" },
    { subject: "HCLTech launch day", start: at(toMonday + 35, 0, 0), end: at(toMonday + 36, 0, 0), isAllDay: true, calendarId: "cal-gsi" },
    { subject: "Q4 planning offsite", start: at(toMonday + 37, 9, 0), end: at(toMonday + 37, 17, 0), attendees: [att(PEOPLE.siva), att(PEOPLE.anirudh)], location: { displayName: "Bengaluru office" } },
    { subject: "Cognizant enablement deck review", start: at(toMonday + 38, 11, 0), end: at(toMonday + 38, 12, 0), calendarId: "cal-gsi", attendees: [att(PEOPLE.tom, "accepted")] },
    { subject: "Analyst briefing: Gartner", start: at(toMonday - 3, 15, 0), end: at(toMonday - 3, 16, 0), attendees: [att(PEOPLE.siva)] },
    { subject: "Infosys MDF claim", start: at(toMonday - 5, 0, 0), end: at(toMonday - 4, 0, 0), isAllDay: true, calendarId: "cal-gsi", showAs: "free" },
    { subject: "LinkedIn campaign retro", start: at(toMonday - 8, 11, 0), end: at(toMonday - 8, 12, 0), attendees: [att(PEOPLE.anirudh)] },
  ];
  for (const s of singles) list.push(mk(s));
  return list;
}

let events: StoredEvent[] = seed();

const DAY_INDEX: Record<DayOfWeek, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function occurrenceId(masterId: string, date: Date) {
  return `${masterId}_${ymdUtc(date).replace(/-/g, "")}`;
}

// Expand a series master into occurrences inside [from, to).
function expand(master: StoredEvent, from: Date, to: Date): StoredEvent[] {
  const rec = master.recurrence;
  if (!rec) return [];
  const out: StoredEvent[] = [];
  const start = new Date(master.start.dateTime.replace(/\.\d+$/, "Z"));
  const durMs = new Date(master.end.dateTime.replace(/\.\d+$/, "Z")).getTime() - start.getTime();
  const localStart = new Date(start);
  const endLimit = rec.range.type === "endDate" && rec.range.endDate ? new Date(`${rec.range.endDate}T23:59:59`) : null;
  const maxCount = rec.range.type === "numbered" ? rec.range.numberOfOccurrences ?? 0 : Infinity;
  const days = (rec.pattern.daysOfWeek ?? []).map((d) => DAY_INDEX[d]);
  let count = 0;
  const cursor = new Date(localStart);
  for (let guard = 0; guard < 1000 && count < maxCount; guard++) {
    if (cursor > to || (endLimit && cursor > endLimit)) break;
    const dow = cursor.getDay();
    const daysSinceStart = Math.round((cursor.getTime() - localStart.getTime()) / 86_400_000);
    let hit = false;
    if (rec.pattern.type === "daily") hit = daysSinceStart % rec.pattern.interval === 0;
    else if (rec.pattern.type === "weekly") {
      const weeks = Math.floor(daysSinceStart / 7);
      hit = days.includes(dow) && weeks % rec.pattern.interval === 0;
    } else if (rec.pattern.type === "absoluteMonthly") hit = cursor.getDate() === (rec.pattern.dayOfMonth ?? localStart.getDate());
    else if (rec.pattern.type === "absoluteYearly") hit = cursor.getDate() === localStart.getDate() && cursor.getMonth() === localStart.getMonth();
    if (hit) {
      count++;
      const key = ymd(cursor);
      const exception = events.find((e) => e.seriesMasterId === master.id && e.type === "exception" && e.originalStart === key);
      if (!master.deletedOccurrences?.includes(key)) {
        if (exception) {
          if (new Date(exception.start.dateTime.replace(/\.\d+$/, "Z")) < to && new Date(exception.end.dateTime.replace(/\.\d+$/, "Z")) > from) out.push(exception);
        } else if (cursor >= from && cursor < to) {
          const s = new Date(cursor);
          out.push({ ...master, id: occurrenceId(master.id, s), type: "occurrence", seriesMasterId: master.id, recurrence: null, start: utc(s), end: utc(new Date(s.getTime() + durMs)) });
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function inRange(e: StoredEvent, from: Date, to: Date) {
  if (e.isAllDay) {
    const s = new Date(`${e.start.dateTime.slice(0, 10)}T00:00:00`);
    const en = new Date(`${e.end.dateTime.slice(0, 10)}T00:00:00`);
    return s < to && en > from;
  }
  return new Date(e.start.dateTime.replace(/\.\d+$/, "Z")) < to && new Date(e.end.dateTime.replace(/\.\d+$/, "Z")) > from;
}

function view(calendarId: string | null, from: Date, to: Date): GraphEvent[] {
  const out: StoredEvent[] = [];
  for (const e of events) {
    if (calendarId && e.calendarId !== calendarId) continue;
    if (e.type === "seriesMaster") out.push(...expand(e, from, to));
    else if (e.type === "exception") continue; // emitted by expand
    else if (inRange(e, from, to)) out.push(e);
  }
  return out.map(strip);
}

function strip(e: StoredEvent): GraphEvent {
  const { calendarId: _c, originalStart: _o, deletedOccurrences: _d, ...rest } = e;
  void _c;
  void _o;
  void _d;
  return rest;
}

function findById(id: string): { event: StoredEvent; occurrenceDate?: string; master?: StoredEvent } | null {
  const direct = events.find((e) => e.id === id);
  if (direct) return { event: direct };
  const m = /^(.+)_(\d{8})$/.exec(id);
  if (m) {
    const master = events.find((e) => e.id === m[1]);
    if (master) {
      const key = `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6, 8)}`;
      const d = new Date(`${key}T00:00:00`);
      const occ = expand(master, new Date(d.getTime() - 86_400_000), new Date(d.getTime() + 2 * 86_400_000)).find((o) => o.id === id);
      if (occ) return { event: occ, occurrenceDate: key, master };
    }
  }
  return null;
}

function applyPatch(target: StoredEvent, body: Record<string, unknown>) {
  const b = body as Partial<GraphEvent>;
  Object.assign(target, b);
  if (b.isOnlineMeeting && b.onlineMeetingProvider === "teamsForBusiness" && !target.onlineMeeting?.joinUrl) Object.assign(target, teams(target.id));
  if (b.body?.content !== undefined) target.bodyPreview = b.body.content.slice(0, 255);
}

function availabilityFor(email: string, slots: number): string {
  // Deterministic: derived from the address so the same person always looks the same.
  let h = 0;
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  let s = "";
  for (let i = 0; i < slots; i++) {
    const v = (h >> (i % 24)) & 7;
    s += v < 4 ? "0" : v === 4 ? "1" : v < 7 ? "2" : "3";
  }
  return s;
}

const TIME_ZONES = [
  "Asia/Kolkata",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Asia/Dubai",
];

export function resetCalendarMock() {
  events = seed();
}

export const handleCalendar: MockHandler = (method, url, body) => {
  const p = url.pathname.replace(/^\/v1\.0/, "");
  const q = url.searchParams;
  const range = () => {
    const s = q.get("startDateTime");
    const e = q.get("endDateTime");
    return { from: s ? new Date(s) : new Date(0), to: e ? new Date(e) : new Date(8.64e15) };
  };

  if (p === "/me/calendars" && method === "GET") return { value: MOCK_CALENDARS };
  if (p.startsWith("/me/outlook/supportedTimeZones")) return { value: TIME_ZONES.map((alias) => ({ alias, displayName: alias })) };

  let m = /^\/me\/calendars\/([^/]+)\/calendarView$/.exec(p);
  if (m && method === "GET") {
    const { from, to } = range();
    return { value: view(decodeURIComponent(m[1]), from, to) };
  }
  if (p === "/me/calendarView" && method === "GET") {
    const { from, to } = range();
    return { value: view("cal-default", from, to) };
  }
  if (p === "/me/calendarView/delta" && method === "GET") {
    return { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=mock" };
  }
  if (p.startsWith("/me/reminderView")) {
    const rm = /startDateTime='([^']+)',endDateTime='([^']+)'/.exec(decodeURIComponent(p));
    const from = rm ? new Date(rm[1]) : new Date();
    const to = rm ? new Date(rm[2]) : new Date(Date.now() + 3600_000);
    const list = view(null, from, new Date(to.getTime() + 2 * 3600_000)).filter((e) => e.isReminderOn && !e.isAllDay && !e.isCancelled);
    return {
      value: list
        .map((e) => {
          const start = new Date(e.start.dateTime.replace(/\.\d+$/, "Z"));
          const fire = new Date(start.getTime() - (e.reminderMinutesBeforeStart ?? 15) * 60_000);
          return { eventId: e.id, eventSubject: e.subject, eventStartTime: e.start, eventEndTime: e.end, eventLocation: e.location, reminderFireTime: utc(fire), changeKey: "mock" };
        })
        .filter((r) => {
          const t = new Date(r.reminderFireTime.dateTime.replace(/\.\d+$/, "Z"));
          return t >= from && t <= to;
        }),
    };
  }

  if (p === "/me/calendar/getSchedule" && method === "POST") {
    const b = body as { schedules: string[]; startTime: { dateTime: string }; endTime: { dateTime: string }; availabilityViewInterval?: number };
    const ivl = b.availabilityViewInterval ?? 30;
    const ms = new Date(b.endTime.dateTime).getTime() - new Date(b.startTime.dateTime).getTime();
    const slots = Math.max(1, Math.round(ms / 60_000 / ivl));
    return { value: b.schedules.map((s) => ({ scheduleId: s, availabilityView: s === ME.address ? "0".repeat(slots) : availabilityFor(s, slots), workingHours: null })) };
  }

  m = /^\/me\/(?:calendars\/([^/]+)\/)?events$/.exec(p);
  if (m && method === "POST") {
    const b = body as Partial<GraphEvent> & { transactionId?: string };
    const dup = b.transactionId && events.find((e) => (e as StoredEvent & { transactionId?: string }).transactionId === b.transactionId);
    if (dup) return strip(dup);
    const id = nid();
    const ev: StoredEvent & { transactionId?: string } = {
      ...mk({ subject: b.subject ?? "", start: new Date(), end: new Date(), id, calendarId: m[1] ? decodeURIComponent(m[1]) : "cal-default" }),
      ...b,
      id,
      type: b.recurrence ? "seriesMaster" : "singleInstance",
      start: b.start!,
      end: b.end!,
      bodyPreview: b.body?.content?.slice(0, 255) ?? "",
      attendees: (b.attendees ?? []).map((a) => ({ ...a, status: { response: "none", time: "0001-01-01T00:00:00Z" } })),
      organizer: { emailAddress: ME },
      isOrganizer: true,
      responseStatus: { response: "organizer" },
      transactionId: b.transactionId,
    };
    if (b.isOnlineMeeting && b.onlineMeetingProvider === "teamsForBusiness") Object.assign(ev, teams(id));
    events.push(ev);
    return strip(ev);
  }

  m = /^\/me\/events\/([^/]+)(?:\/(accept|tentativelyAccept|decline|cancel))?$/.exec(p);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const action = m[2];
    const found = findById(id);
    if (!found) return { error: { code: "ErrorItemNotFound", message: `Event ${id} not found` } };
    const { event, occurrenceDate, master } = found;
    if (method === "GET") return strip(event);
    if (method === "DELETE") {
      if (occurrenceDate && master) master.deletedOccurrences = [...(master.deletedOccurrences ?? []), occurrenceDate];
      else events = events.filter((e) => e.id !== event.id && e.seriesMasterId !== event.id);
      return undefined;
    }
    if (method === "PATCH") {
      if (occurrenceDate && master && event.type === "occurrence") {
        const ex: StoredEvent = { ...event, id: `${master.id}_${occurrenceDate.replace(/-/g, "")}`, type: "exception", originalStart: occurrenceDate, recurrence: null };
        applyPatch(ex, body as Record<string, unknown>);
        events.push(ex);
        return strip(ex);
      }
      applyPatch(event, body as Record<string, unknown>);
      return strip(event);
    }
    if (method === "POST" && action) {
      const target = event.type === "occurrence" && master ? master : event;
      if (action === "cancel") {
        events = events.filter((e) => e.id !== target.id && e.seriesMasterId !== target.id);
        return undefined;
      }
      const resp: ResponseType = action === "accept" ? "accepted" : action === "decline" ? "declined" : "tentativelyAccepted";
      target.responseStatus = { response: resp, time: new Date().toISOString() };
      target.attendees = (target.attendees ?? []).map((a) => (a.emailAddress.address === ME.address ? { ...a, status: { response: resp, time: new Date().toISOString() } } : a));
      if (action === "decline") events = events.filter((e) => e.id !== target.id);
      return undefined;
    }
  }
  return undefined;
};
