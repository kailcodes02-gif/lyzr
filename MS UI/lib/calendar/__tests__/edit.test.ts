import { describe, expect, it } from "vitest";
import { bodyPatch, bodyToText, moveBody, patchBody, withAttendees } from "../edit";
import { defaultForm } from "../recurrence";
import type { EventDraft } from "../types";

const TZ = "Asia/Kolkata";

describe("moveBody (drag / resize PATCH)", () => {
  it("passes FullCalendar's exclusive all-day end through unchanged", () => {
    // A one-day all-day event on the 21st: FullCalendar reports endStr 2026-09-22 (exclusive).
    const b = moveBody({ start: "2026-09-21", end: "2026-09-22", allDay: true }, TZ);
    expect(b.start?.dateTime).toBe("2026-09-21T00:00:00");
    expect(b.end?.dateTime).toBe("2026-09-22T00:00:00");
    expect(b.isAllDay).toBe(true);
  });
  it("derives the exclusive end only when FullCalendar gives no end", () => {
    const b = moveBody({ start: "2026-10-07", end: "", allDay: true }, TZ);
    expect(b.end?.dateTime).toBe("2026-10-08T00:00:00");
  });
  it("keeps timed moves as-is", () => {
    const b = moveBody({ start: "2026-09-21T10:00:00", end: "2026-09-21T11:30:00", allDay: false }, TZ);
    expect(b).toEqual({ isAllDay: false, start: { dateTime: "2026-09-21T10:00:00", timeZone: TZ }, end: { dateTime: "2026-09-21T11:30:00", timeZone: TZ } });
  });
});

const TEAMS = '<div>Agenda:<br>1. Numbers</div><div class="me-email-text" style="color:#252424"><span>Microsoft Teams meeting</span><a href="https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0" id="meet-link">Join on your computer</a></div>';

describe("body", () => {
  it("shows plain text of an HTML body without the Teams blob", () => {
    expect(bodyToText({ contentType: "html", content: TEAMS })).toBe("Agenda:\n1. Numbers");
    expect(bodyToText({ contentType: "text", content: "plain" })).toBe("plain");
    expect(bodyToText(undefined)).toBe("");
  });
  it("omits body when the description is unchanged", () => {
    expect(bodyPatch({ contentType: "html", content: TEAMS }, "Agenda:\n1. Numbers", true)).toBeUndefined();
    expect(bodyPatch({ contentType: "text", content: "hi" }, "hi")).toBeUndefined();
    expect(bodyPatch(undefined, "")).toBeUndefined();
  });
  it("keeps HTML and carries the Teams blob over when the description changes", () => {
    const b = bodyPatch({ contentType: "html", content: TEAMS }, "New agenda <3", true)!;
    expect(b.contentType).toBe("html");
    expect(b.content).toContain("New agenda &lt;3");
    expect(b.content).toContain("meetup-join");
    expect(b.content).not.toContain("1. Numbers");
  });
  it("sends text for a text body", () => {
    expect(bodyPatch({ contentType: "text", content: "old" }, "new")).toEqual({ contentType: "text", content: "new" });
  });
});

const orig: EventDraft = {
  id: "evt-sync",
  calendarId: "cal-default",
  subject: "GSI weekly sync",
  start: "2026-09-22T10:00",
  end: "2026-09-22T10:30",
  allDay: false,
  attendees: [{ name: "Siva", email: "siva@lyzr.ai" }],
  location: "Teams",
  teams: true,
  reminder: 15,
  description: "Agenda:\n1. Numbers",
  recurrence: { pattern: { type: "weekly", interval: 1, daysOfWeek: ["tuesday"] }, range: { type: "noEnd", startDate: "2026-07-28" } },
  recurrenceForm: { ...defaultForm("2026-09-22"), preset: "weekly" },
  recurrenceTouched: false,
  showAs: "busy",
  isPrivate: false,
};
const opts = { tz: TZ, defaultReminder: 15, originalBody: { contentType: "html" as const, content: TEAMS }, isOnlineMeeting: true };

describe("patchBody (only changed fields)", () => {
  it("sends nothing for an untouched draft", () => {
    expect(patchBody(orig, { ...orig }, { ...opts, scope: "all" })).toEqual({});
  });
  it("a title change on the series master sends only the subject: no recurrence, no body, no attendees", () => {
    const b = patchBody(orig, { ...orig, subject: "GSI weekly sync (EMEA)" }, { ...opts, scope: "all" });
    expect(b).toEqual({ subject: "GSI weekly sync (EMEA)" });
    expect("recurrence" in b).toBe(false);
    expect("body" in b).toBe(false);
  });
  it("never sends recurrence: null to a series master", () => {
    const b = patchBody(orig, { ...orig, recurrenceTouched: true, recurrenceForm: defaultForm("2026-09-22"), recurrence: null }, { ...opts, scope: "all" });
    expect("recurrence" in b).toBe(false);
  });
  it("derives the recurrence from the form and the edited start date", () => {
    const next = { ...orig, start: "2026-09-24T10:00", end: "2026-09-24T10:30", recurrenceTouched: true };
    const b = patchBody(orig, next, { ...opts, scope: "all" });
    expect(b.recurrence?.range.startDate).toBe("2026-09-24");
    expect(b.recurrence?.pattern.daysOfWeek).toEqual(["thursday"]);
    expect(b.start?.dateTime).toBe("2026-09-24T10:00:00");
    expect(b.isAllDay).toBe(false);
  });
  it("does not toggle isOnlineMeeting on an existing online meeting and keeps body unless edited", () => {
    const b = patchBody(orig, { ...orig, teams: false, description: "Agenda:\n1. Numbers\n2. Pipeline" }, opts);
    expect("isOnlineMeeting" in b).toBe(false);
    expect(b.body?.contentType).toBe("html");
    expect(b.body?.content).toContain("meetup-join");
    expect(b.body?.content).toContain("2. Pipeline");
  });
  it("sends attendees, reminder, showAs, sensitivity when they change", () => {
    const b = patchBody(orig, { ...orig, attendees: [], reminder: null, showAs: "free", isPrivate: true }, opts);
    expect(b.attendees).toEqual([]);
    expect(b).toMatchObject({ isReminderOn: false, reminderMinutesBeforeStart: 0, showAs: "free", sensitivity: "private" });
  });
});

describe("withAttendees (Teams switch follows the guest list on new events)", () => {
  const draft: EventDraft = {
    calendarId: "c",
    subject: "",
    start: "2026-09-22T09:00",
    end: "2026-09-22T09:30",
    allDay: false,
    attendees: [],
    location: "",
    teams: false,
    teamsAuto: true,
    reminder: 15,
    description: "",
    recurrence: null,
    showAs: "busy",
    isPrivate: false,
  };
  const siva = { name: "Siva", email: "siva@lyzr.ai" };
  it("turns Teams on with the first guest when the calendar allows it, off again without guests", () => {
    const withGuest = withAttendees(draft, [siva], true);
    expect(withGuest.teams).toBe(true);
    expect(withAttendees(withGuest, [], true).teams).toBe(false);
  });
  it("stays off on a calendar without Teams", () => {
    expect(withAttendees(draft, [siva], false).teams).toBe(false);
  });
  it("leaves the switch alone once the user has toggled it", () => {
    const manual = { ...draft, teamsAuto: false, teams: false };
    expect(withAttendees(manual, [siva], true).teams).toBe(false);
    const manualOn = { ...draft, teamsAuto: false, teams: true, attendees: [siva] };
    expect(withAttendees(manualOn, [], true).teams).toBe(true);
  });
  it("edit drafts (no teamsAuto) never flip the switch", () => {
    const edit = { ...draft, teamsAuto: undefined, teams: false };
    expect(withAttendees(edit, [siva], true).teams).toBe(false);
  });
});
