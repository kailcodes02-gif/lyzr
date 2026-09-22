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
    canShare: true,
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
    canShare: true,
    owner: ME,
    allowedOnlineMeetingProviders: [],
    defaultOnlineMeetingProvider: "unknown",
  },
];

// A colleague's calendar shared with me (sits in the "Other Calendars" group).
export const MOCK_SHARED_CALENDAR: GraphCalendar = {
  id: "cal-shared-siva",
  name: "Siva Surendira",
  color: "lightOrange",
  hexColor: "",
  isDefaultCalendar: false,
  canEdit: false,
  canShare: false,
  owner: PEOPLE.siva,
  allowedOnlineMeetingProviders: [],
  defaultOnlineMeetingProvider: "unknown",
};

export const MOCK_CALENDAR_GROUPS = [
  { id: "cg-my", name: "My Calendars", classId: "0006f0b7-0000-0000-c000-000000000046", calendars: MOCK_CALENDARS },
  { id: "cg-other", name: "Other Calendars", classId: "0006f0b7-0000-0000-c000-000000000046", calendars: [MOCK_SHARED_CALENDAR] },
];

// The Lyzr directory as /me/people and /users see it.
export type MockUser = { id: string; displayName: string; mail: string; userPrincipalName: string; jobTitle: string };
export const MOCK_DIRECTORY: MockUser[] = [
  ["u01", "Siva Surendira", "siva@lyzr.ai", "CEO"],
  ["u02", "Anirudh Narayan", "anirudh@lyzr.ai", "GSI Partnerships Lead"],
  ["u03", "Ani Sharma", "ani.sharma@lyzr.ai", "Solutions Engineer"],
  ["u04", "Anita Krishnan", "anita.k@lyzr.ai", "Product Marketing"],
  ["u05", "Kailash G M", "kailash.gm@lyzr.com", "Marketing"],
  ["u06", "Harshad Patel", "harshad@lyzr.ai", "CTO"],
  ["u07", "Ramya Iyer", "ramya@lyzr.ai", "Head of Design"],
  ["u08", "Vikram Nair", "vikram@lyzr.ai", "Solutions Engineer"],
  ["u09", "Deepa Menon", "deepa@lyzr.ai", "Customer Success Manager"],
  ["u10", "Arjun Reddy", "arjun@lyzr.ai", "Account Executive"],
  ["u11", "Meera Pillai", "meera@lyzr.ai", "Content Marketing"],
  ["u12", "Rohan Das", "rohan@lyzr.ai", "Growth Marketing"],
  ["u13", "Sneha Kulkarni", "sneha@lyzr.ai", "Demand Generation"],
  ["u14", "Karthik Subramanian", "karthik@lyzr.ai", "Principal Engineer"],
  ["u15", "Lakshmi Venkat", "lakshmi@lyzr.ai", "Finance"],
  ["u16", "Nikhil Bhat", "nikhil@lyzr.ai", "Solutions Engineer"],
  ["u17", "Pooja Shetty", "pooja@lyzr.ai", "People Operations"],
  ["u18", "Aditya Rao", "aditya@lyzr.ai", "Partner Marketing"],
  ["u19", "Divya Anand", "divya@lyzr.ai", "Sales Development"],
  ["u20", "Manish Gupta", "manish@lyzr.ai", "VP Sales"],
  ["u21", "Shruti Desai", "shruti@lyzr.ai", "Events Marketing"],
  ["u22", "Varun Mehta", "varun@lyzr.ai", "Forward Deployed Engineer"],
  ["u23", "Tanvi Joshi", "tanvi@lyzr.ai", "Legal"],
  ["u24", "Rahul Agarwal", "rahul.a@lyzr.ai", "Enterprise Sales"],
  ["u25", "Ananya Bose", "ananya@lyzr.ai", "Solutions Architect"],
].map(([id, displayName, mail, jobTitle]) => ({ id, displayName, mail, userPrincipalName: mail, jobTitle }));

function unquote(v: string | null): string {
  return (v ?? "").replace(/^"|"$/g, "").trim().toLowerCase();
}
function userMatches(u: MockUser, q: string) {
  if (!q) return true;
  return u.displayName.toLowerCase().includes(q) || u.mail.toLowerCase().includes(q) || u.displayName.toLowerCase().split(/\s+/).some((w) => w.startsWith(q));
}
function toPerson(u: MockUser) {
  return {
    id: u.id,
    displayName: u.displayName,
    jobTitle: u.jobTitle,
    userPrincipalName: u.userPrincipalName,
    scoredEmailAddresses: [{ address: u.mail, relevanceScore: 20 }],
    personType: { class: "Person", subclass: "OrganizationUser" },
  };
}

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

  // Siva's calendar, shared with me with full details.
  const siva = (o: MkInput): MkInput => ({ ...o, calendarId: "cal-shared-siva", organizer: { emailAddress: PEOPLE.siva }, attendees: [att(PEOPLE.siva, "organizer"), ...(o.attendees ?? [])] });
  const sivaEvents: MkInput[] = [
    { subject: "Board prep", start: at(toMonday, 9, 0), end: at(toMonday, 10, 0), ...body("Q3 numbers.") },
    { subject: "Investor call", start: at(toMonday + 1, 15, 0), end: at(toMonday + 1, 16, 0), ...teams("siva-investor") },
    { subject: "Lyzr leadership sync", start: at(toMonday + 2, 9, 30), end: at(toMonday + 2, 10, 30), attendees: [att(PEOPLE.anirudh)], ...teams("siva-lead") },
    { subject: "Accenture exec dinner", start: at(toMonday + 3, 19, 0), end: at(toMonday + 3, 21, 0), location: { displayName: "Chennai" } },
    { subject: "Out of office", start: at(toMonday + 4, 12, 0), end: at(toMonday + 4, 18, 0), showAs: "oof" },
    { subject: "Hiring panel", start: at(toMonday + 8, 11, 0), end: at(toMonday + 8, 12, 0) },
  ];
  for (const s of sivaEvents) list.push(mk(siva(s)));
  return list;
}

// Deterministic busy blocks for getSchedule: the same address always yields the same week.
function scheduleItemsFor(email: string, from: Date, to: Date) {
  const addr = email.toLowerCase();
  const stored = events.filter((e) => e.calendarId === "cal-shared-siva");
  const internal = /@lyzr\.(ai|com)$/.test(addr);
  const out: { status: string; subject?: string; location?: string; isPrivate?: boolean; start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } }[] = [];
  if (addr === PEOPLE.siva.address) {
    for (const e of stored) {
      if (!inRange(e, from, to) || e.isAllDay) continue;
      out.push({ status: e.showAs ?? "busy", subject: e.subject, location: e.location?.displayName, isPrivate: e.sensitivity === "private", start: e.start, end: e.end });
    }
    return out;
  }
  let h = 0;
  for (const ch of addr) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const SUBJECTS = ["Customer call", "Design review", "Pipeline review", "1:1", "Partner sync", "Focus time", "Sprint planning", "Interview"];
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  for (let i = 0; day < to && i < 70; i++, day.setDate(day.getDate() + 1)) {
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue;
    const seedN = (h + i * 2654435761) >>> 0;
    const count = 1 + (seedN % 3);
    for (let k = 0; k < count; k++) {
      const v = (seedN >> (k * 5)) & 31;
      const startH = 9 + (v % 8);
      const dur = [30, 60, 60, 90][v % 4];
      const st = new Date(day);
      st.setHours(startH, v % 2 ? 30 : 0, 0, 0);
      const en = plusMin(st, dur);
      if (en <= from || st >= to) continue;
      const status = v % 7 === 0 ? "tentative" : v % 11 === 0 ? "oof" : "busy";
      out.push({ status, subject: internal ? SUBJECTS[(v + k) % SUBJECTS.length] : undefined, start: utc(st), end: utc(en) });
    }
  }
  return out;
}

let events: StoredEvent[] = seed();

// ---------- delta change log ----------
// Every write appends here; /me/calendarView/delta with a token returns the
// entries after that token, so the client's polling path sees exactly what
// changed (its own writes included, which it recognises and ignores).
type Change = { seq: number; id: string; removed?: boolean };
let changeSeq = 0;
let changes: Change[] = [];
function logChange(id: string, removed = false) {
  changes.push({ seq: ++changeSeq, id, removed });
}

// An event "created in Outlook" while the demo runs: it is materialised only
// by the delta handler, ARRIVAL_MS after the mock booted, so it appears on
// screen through polling alone (no reload, no full refetch).
export const OUTLOOK_ARRIVAL_MS = 20_000;
export const OUTLOOK_ARRIVAL_SUBJECT = "Added in Outlook";
let bootAt = Date.now();
let arrived = false;
function maybeArriveFromOutlook(now = Date.now()) {
  if (arrived || now - bootAt < OUTLOOK_ARRIVAL_MS) return;
  arrived = true;
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 2);
  const ev = mk({ id: "evt-from-outlook", subject: OUTLOOK_ARRIVAL_SUBJECT, start, end: plusMin(start, 30), attendees: [att(PEOPLE.siva)], location: { displayName: "Created in Outlook on the web" } });
  events.push(ev);
  logChange(ev.id);
}

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

export function resetCalendarMock(opts: { bootAt?: number } = {}) {
  events = seed();
  changes = [];
  changeSeq = 0;
  arrived = false;
  bootAt = opts.bootAt ?? Date.now();
}

export const handleCalendar: MockHandler = (method, url, body) => {
  const p = url.pathname.replace(/^\/v1\.0/, "");
  const q = url.searchParams;
  let m: RegExpExecArray | null;
  const range = () => {
    const s = q.get("startDateTime");
    const e = q.get("endDateTime");
    return { from: s ? new Date(s) : new Date(0), to: e ? new Date(e) : new Date(8.64e15) };
  };

  if (p === "/me/calendars" && method === "GET") return { value: MOCK_CALENDARS };
  if (p === "/me/calendarGroups" && method === "GET") return { value: MOCK_CALENDAR_GROUPS.map(({ calendars: _c, ...g }) => (void _c, g)) };
  m = /^\/me\/calendarGroups\/([^/]+)\/calendars$/.exec(p);
  if (m && method === "GET") {
    const g = MOCK_CALENDAR_GROUPS.find((x) => x.id === decodeURIComponent(m![1]));
    if (!g) throw new Error("ErrorItemNotFound: calendar group not found");
    return { value: g.calendars };
  }
  // Like Graph, a $select without `body` leaves the body out (the popover / editor fetch it separately).
  const selected = (list: GraphEvent[]) => {
    const sel = q.get("$select");
    if (!sel || sel.split(",").includes("body")) return list;
    return list.map(({ body: _b, ...rest }) => {
      void _b;
      return rest as GraphEvent;
    });
  };
  m = /^\/me\/calendarGroups\/[^/]+\/calendars\/([^/]+)\/calendarView$/.exec(p);
  if (m && method === "GET") {
    const { from, to } = range();
    return { value: selected(view(decodeURIComponent(m[1]), from, to)) };
  }
  // Another user's calendar: only Siva shares with details; everyone else is 403 (needs Calendars.Read.Shared + sharing).
  m = /^\/users\/([^/]+)\/calendarView$/.exec(p);
  if (m && method === "GET") {
    const upn = decodeURIComponent(m[1]).toLowerCase();
    if (upn !== PEOPLE.siva.address) throw new Error("ErrorAccessDenied: Access is denied. Check credentials and try again.");
    const { from, to } = range();
    return { value: view("cal-shared-siva", from, to) };
  }
  if (p === "/me/people" && method === "GET") {
    const term = unquote(q.get("$search"));
    const top = Number(q.get("$top") ?? 10);
    return { value: MOCK_DIRECTORY.filter((u) => userMatches(u, term)).slice(0, top).map(toPerson) };
  }
  if (p === "/users" && method === "GET") {
    const raw = q.get("$search") ?? "";
    const terms = Array.from(raw.matchAll(/"(?:displayName|mail):([^"]*)"/g)).map((x) => x[1].toLowerCase());
    const top = Number(q.get("$top") ?? 10);
    const hits = MOCK_DIRECTORY.filter((u) => (terms.length ? terms.some((t) => userMatches(u, t)) : true)).slice(0, top);
    return { "@odata.count": hits.length, value: hits.map(({ id, displayName, mail, userPrincipalName, jobTitle }) => ({ id, displayName, mail, userPrincipalName, jobTitle })) };
  }
  if (p.startsWith("/me/outlook/supportedTimeZones")) return { value: TIME_ZONES.map((alias) => ({ alias, displayName: alias })) };

  m = /^\/me\/calendars\/([^/]+)\/calendarView$/.exec(p);
  if (m && method === "GET") {
    const { from, to } = range();
    return { value: selected(view(decodeURIComponent(m[1]), from, to)) };
  }
  if (p === "/me/calendarView" && method === "GET") {
    const { from, to } = range();
    return { value: selected(view("cal-default", from, to)) };
  }
  if (p === "/me/calendarView/delta" && method === "GET") {
    maybeArriveFromOutlook();
    const token = q.get("$deltatoken");
    const link = (seq: number) => `https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=mock-${seq}`;
    if (!token) {
      // Initial round: everything in the range, then a token.
      const { from, to } = range();
      return { value: view("cal-default", from, to), "@odata.deltaLink": link(changeSeq) };
    }
    const since = Number(/^mock-(\d+)$/.exec(token)?.[1] ?? 0);
    const seen = new Set<string>();
    const value: (GraphEvent | { id: string; "@removed": { reason: string } })[] = [];
    for (const c of changes.filter((x) => x.seq > since).reverse()) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      if (c.removed) {
        value.push({ id: c.id, "@removed": { reason: "deleted" } });
        continue;
      }
      const cur = events.find((e) => e.id === c.id && e.calendarId === "cal-default");
      if (cur) value.push(strip(cur));
    }
    return { value: value.reverse(), "@odata.deltaLink": link(changeSeq) };
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
    const from = new Date(b.startTime.dateTime);
    const to = new Date(b.endTime.dateTime);
    return {
      value: b.schedules.map((s) => {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { scheduleId: s, availabilityView: "", scheduleItems: [], error: { message: "The address is not a valid SMTP address.", responseCode: "ErrorInvalidSmtpAddress" } };
        if (s === ME.address) return { scheduleId: s, availabilityView: "0".repeat(slots), scheduleItems: [], workingHours: null };
        return { scheduleId: s, availabilityView: availabilityFor(s, slots), scheduleItems: scheduleItemsFor(s, from, to), workingHours: null };
      }),
    };
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
    events.push(ev);
    logChange(id);
    // Like Outlook, the join link is provisioned after the POST answers: the
    // response carries onlineMeeting null and the next read has the URL.
    const response = strip(ev);
    if (b.isOnlineMeeting && b.onlineMeetingProvider === "teamsForBusiness") Object.assign(ev, teams(id));
    return response;
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
      logChange(id, true);
      return undefined;
    }
    if (method === "PATCH") {
      if (occurrenceDate && master && event.type === "occurrence") {
        const ex: StoredEvent = { ...event, id: `${master.id}_${occurrenceDate.replace(/-/g, "")}`, type: "exception", originalStart: occurrenceDate, recurrence: null };
        applyPatch(ex, body as Record<string, unknown>);
        events.push(ex);
        logChange(ex.id);
        return strip(ex);
      }
      applyPatch(event, body as Record<string, unknown>);
      logChange(event.id);
      return strip(event);
    }
    if (method === "POST" && action) {
      const target = event.type === "occurrence" && master ? master : event;
      if (action === "cancel") {
        events = events.filter((e) => e.id !== target.id && e.seriesMasterId !== target.id);
        logChange(target.id, true);
        return undefined;
      }
      const resp: ResponseType = action === "accept" ? "accepted" : action === "decline" ? "declined" : "tentativelyAccepted";
      target.responseStatus = { response: resp, time: new Date().toISOString() };
      target.attendees = (target.attendees ?? []).map((a) => (a.emailAddress.address === ME.address ? { ...a, status: { response: resp, time: new Date().toISOString() } } : a));
      if (action === "decline") events = events.filter((e) => e.id !== target.id);
      logChange(target.id, action === "decline");
      return undefined;
    }
  }
  return undefined;
};
