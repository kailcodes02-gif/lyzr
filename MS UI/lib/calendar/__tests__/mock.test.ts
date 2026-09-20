import { beforeEach, describe, expect, it } from "vitest";
import { handleCalendar, OUTLOOK_ARRIVAL_MS, OUTLOOK_ARRIVAL_SUBJECT, resetCalendarMock } from "@/lib/mock/calendar";
import type { GraphEvent } from "../types";

const u = (path: string) => new URL(`https://graph.microsoft.com/v1.0${path}`);
const iso = (d: Date) => d.toISOString();
const monthRange = () => {
  const from = new Date();
  from.setDate(from.getDate() - 14);
  const to = new Date();
  to.setDate(to.getDate() + 21);
  return `startDateTime=${encodeURIComponent(iso(from))}&endDateTime=${encodeURIComponent(iso(to))}`;
};

describe("calendar mock handler", () => {
  beforeEach(() => resetCalendarMock());

  it("lists two calendars, the default one allowing Teams", () => {
    const r = handleCalendar("GET", u("/me/calendars"), undefined) as { value: { id: string; allowedOnlineMeetingProviders: string[] }[] };
    expect(r.value).toHaveLength(2);
    expect(r.value[0].allowedOnlineMeetingProviders).toContain("teamsForBusiness");
  });

  it("expands the weekly series into occurrences with one exception", () => {
    const r = handleCalendar("GET", u(`/me/calendars/cal-default/calendarView?${monthRange()}`), undefined) as { value: GraphEvent[] };
    const sync = r.value.filter((e) => e.seriesMasterId === "evt-sync");
    expect(sync.length).toBeGreaterThanOrEqual(4);
    expect(sync.filter((e) => e.type === "exception")).toHaveLength(1);
    expect(sync.filter((e) => e.type === "occurrence").every((e) => /^evt-sync_\d{8}$/.test(e.id))).toBe(true);
    expect(r.value.some((e) => e.type === "seriesMaster")).toBe(false);
  });

  it("creates an event that shows on the next calendarView, and de-dupes by transactionId", () => {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(15, 0, 0, 0);
    const body = { subject: "Infosys deck review", start: { dateTime: start.toISOString().slice(0, 19), timeZone: "UTC" }, end: { dateTime: new Date(start.getTime() + 3600e3).toISOString().slice(0, 19), timeZone: "UTC" }, isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness", transactionId: "t1" };
    const created = handleCalendar("POST", u("/me/calendars/cal-default/events"), body) as GraphEvent;
    // Like Outlook, the Teams link is provisioned after the POST answers: the next read has it.
    expect(created.isOnlineMeeting).toBe(true);
    expect(created.onlineMeeting?.joinUrl).toBeUndefined();
    const again = handleCalendar("POST", u("/me/calendars/cal-default/events"), body) as GraphEvent;
    expect(again.id).toBe(created.id);
    const r = handleCalendar("GET", u(`/me/calendars/cal-default/calendarView?${monthRange()}`), undefined) as { value: GraphEvent[] };
    const listed = r.value.filter((e) => e.subject === "Infosys deck review");
    expect(listed).toHaveLength(1);
    expect(listed[0].onlineMeeting?.joinUrl).toContain("teams.microsoft.com");
  });

  it("delta: the first round yields a token, later rounds return only what changed (creates, patches, deletes)", () => {
    type Delta = { value: (GraphEvent & { "@removed"?: { reason: string } })[]; "@odata.deltaLink": string };
    const first = handleCalendar("GET", u(`/me/calendarView/delta?${monthRange()}`), undefined) as Delta;
    expect(first.value.length).toBeGreaterThan(0);
    const token = new URL(first["@odata.deltaLink"]).searchParams.get("$deltatoken")!;
    const quiet = handleCalendar("GET", u(`/me/calendarView/delta?$deltatoken=${token}`), undefined) as Delta;
    expect(quiet.value).toEqual([]);
    const start = new Date();
    start.setDate(start.getDate() + 2);
    const created = handleCalendar("POST", u("/me/events"), { subject: "From the phone", start: { dateTime: start.toISOString().slice(0, 19), timeZone: "UTC" }, end: { dateTime: new Date(start.getTime() + 1800e3).toISOString().slice(0, 19), timeZone: "UTC" } }) as GraphEvent;
    handleCalendar("PATCH", u("/me/events/evt-sync-exception"), { subject: "GSI weekly sync (moved again)" });
    handleCalendar("DELETE", u("/me/events/evt-standup"), undefined);
    const next = handleCalendar("GET", u(`/me/calendarView/delta?$deltatoken=${token}`), undefined) as Delta;
    expect(next.value.map((e) => e.id)).toEqual([created.id, "evt-sync-exception", "evt-standup"]);
    expect(next.value[1].subject).toBe("GSI weekly sync (moved again)");
    expect(next.value[2]["@removed"]).toEqual({ reason: "deleted" });
    // the new token is past those changes
    const token2 = new URL(next["@odata.deltaLink"]).searchParams.get("$deltatoken")!;
    expect((handleCalendar("GET", u(`/me/calendarView/delta?$deltatoken=${token2}`), undefined) as Delta).value).toEqual([]);
  });

  it("an event 'Added in Outlook' arrives only through the delta, 20 s after boot", () => {
    resetCalendarMock({ bootAt: Date.now() - OUTLOOK_ARRIVAL_MS + 5000 });
    const has = () => (handleCalendar("GET", u(`/me/calendars/cal-default/calendarView?${monthRange()}`), undefined) as { value: GraphEvent[] }).value.some((e) => e.subject === OUTLOOK_ARRIVAL_SUBJECT);
    type Delta = { value: GraphEvent[]; "@odata.deltaLink": string };
    const first = handleCalendar("GET", u(`/me/calendarView/delta?${monthRange()}`), undefined) as Delta;
    const token = new URL(first["@odata.deltaLink"]).searchParams.get("$deltatoken")!;
    expect(has()).toBe(false);
    resetCalendarMock({ bootAt: Date.now() - OUTLOOK_ARRIVAL_MS - 1 });
    // a plain calendarView does not materialise it...
    expect(has()).toBe(false);
    // ...the delta does, and the next view lists it
    const d = handleCalendar("GET", u(`/me/calendarView/delta?$deltatoken=${token}`), undefined) as Delta;
    expect(d.value.map((e) => e.subject)).toContain(OUTLOOK_ARRIVAL_SUBJECT);
    expect(has()).toBe(true);
  });

  it("patching an occurrence creates an exception; deleting the master removes the series", () => {
    const r = handleCalendar("GET", u(`/me/calendars/cal-default/calendarView?${monthRange()}`), undefined) as { value: GraphEvent[] };
    const occ = r.value.find((e) => e.seriesMasterId === "evt-sync" && e.type === "occurrence")!;
    const patched = handleCalendar("PATCH", u(`/me/events/${occ.id}`), { subject: "GSI sync (renamed)" }) as GraphEvent;
    expect(patched.type).toBe("exception");
    const r2 = handleCalendar("GET", u(`/me/calendars/cal-default/calendarView?${monthRange()}`), undefined) as { value: GraphEvent[] };
    expect(r2.value.filter((e) => e.subject === "GSI sync (renamed)")).toHaveLength(1);
    expect(handleCalendar("DELETE", u("/me/events/evt-sync"), undefined)).toBeUndefined();
    const r3 = handleCalendar("GET", u(`/me/calendars/cal-default/calendarView?${monthRange()}`), undefined) as { value: GraphEvent[] };
    expect(r3.value.some((e) => e.seriesMasterId === "evt-sync")).toBe(false);
  });

  it("accept updates the response status; getSchedule is deterministic", () => {
    const r = handleCalendar("GET", u(`/me/calendars/cal-default/calendarView?${monthRange()}`), undefined) as { value: GraphEvent[] };
    const invite = r.value.find((e) => e.responseStatus?.response === "notResponded")!;
    handleCalendar("POST", u(`/me/events/${invite.id}/accept`), { sendResponse: true });
    const after = handleCalendar("GET", u(`/me/events/${invite.id}`), undefined) as GraphEvent;
    expect(after.responseStatus?.response).toBe("accepted");
    const body = { schedules: ["siva@lyzr.ai"], startTime: { dateTime: "2026-09-21T08:00:00", timeZone: "UTC" }, endTime: { dateTime: "2026-09-21T10:00:00", timeZone: "UTC" }, availabilityViewInterval: 30 };
    const s1 = handleCalendar("POST", u("/me/calendar/getSchedule"), body) as { value: { availabilityView: string }[] };
    const s2 = handleCalendar("POST", u("/me/calendar/getSchedule"), body) as { value: { availabilityView: string }[] };
    expect(s1.value[0].availabilityView).toHaveLength(4);
    expect(s1.value[0].availabilityView).toBe(s2.value[0].availabilityView);
  });
});
