import { beforeEach, describe, expect, it } from "vitest";
import { handleCalendar, resetCalendarMock } from "@/lib/mock/calendar";
import { normalise, toFcPersonEvent } from "../events";
import { groupCalendars, initials, nextColor, scheduleItemsToEvents, splitRange, statusLabel, type Colleague } from "../overlay";
import type { GraphCalendar } from "../types";

const ani: Colleague = { email: "ani.sharma@lyzr.ai", name: "Ani Sharma", color: "#7986cb" };
const u = (path: string) => new URL(`https://graph.microsoft.com/v1.0${path}`);

describe("scheduleItems -> overlay events", () => {
  it("labels by status when no subject is shared and drops free slots", () => {
    const items = [
      { status: "busy", start: { dateTime: "2026-09-21T10:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-09-21T11:00:00.0000000", timeZone: "UTC" } },
      { status: "tentative", start: { dateTime: "2026-09-21T12:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-09-21T12:30:00.0000000", timeZone: "UTC" } },
      { status: "oof", start: { dateTime: "2026-09-22T09:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-09-22T17:00:00.0000000", timeZone: "UTC" } },
      { status: "workingElsewhere", start: { dateTime: "2026-09-23T09:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-09-23T10:00:00.0000000", timeZone: "UTC" } },
      { status: "free", start: { dateTime: "2026-09-23T11:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-09-23T12:00:00.0000000", timeZone: "UTC" } },
      { status: "busy", subject: "Design review", location: "Bay 4", start: { dateTime: "2026-09-24T09:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-09-24T10:00:00.0000000", timeZone: "UTC" } },
      { status: "busy", subject: "Secret", isPrivate: true, start: { dateTime: "2026-09-24T11:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-09-24T12:00:00.0000000", timeZone: "UTC" } },
    ];
    const evs = scheduleItemsToEvents(ani, items, "UTC");
    expect(evs.map((e) => e.subject)).toEqual(["Busy", "Tentative", "Out of office", "Working elsewhere", "Design review", "Busy"]);
    expect(evs.every((e) => e.calendarId === "people:ani.sharma@lyzr.ai")).toBe(true);
    expect(evs[4].location?.displayName).toBe("Bay 4");
    expect(evs[0].organizer?.emailAddress.address).toBe("ani.sharma@lyzr.ai");
    expect(new Set(evs.map((e) => e.id)).size).toBe(evs.length);
  });

  it("renders in the person's colour, read-only, with initials", () => {
    const [ev] = scheduleItemsToEvents(ani, [{ status: "tentative", start: { dateTime: "2026-09-21T10:00:00", timeZone: "UTC" }, end: { dateTime: "2026-09-21T11:00:00", timeZone: "UTC" } }], "UTC");
    const fc = toFcPersonEvent(normalise(ev, "UTC"), ani);
    expect(fc.color).toBe("#7986cb");
    expect(fc.editable).toBe(false);
    expect(fc.className.split(" ")).toContain("msui-ev-colleague");
    expect(fc.className.split(" ")).toContain("msui-ev-tentative");
    expect(fc.extendedProps.person?.initials).toBe("AS");
    expect(fc.title).toBe("Tentative");
  });

  it("keeps overlapping items of one person distinct (busy + tentative on the same slot)", () => {
    const slot = { start: { dateTime: "2026-09-21T10:00:00", timeZone: "UTC" }, end: { dateTime: "2026-09-21T11:00:00", timeZone: "UTC" } };
    const evs = scheduleItemsToEvents(ani, [{ status: "busy", ...slot }, { status: "tentative", ...slot }], "UTC");
    expect(evs).toHaveLength(2);
    expect(evs[0].id).not.toBe(evs[1].id);
  });

  it("maps status labels and initials", () => {
    expect(statusLabel("oof")).toBe("Out of office");
    expect(statusLabel(undefined)).toBe("Busy");
    expect(initials("Anirudh Narayan")).toBe("AN");
    expect(initials("siva")).toBe("S");
    // blue-ish colours are not in the palette any more (blue is the user's own); the first free palette colour wins
    expect(nextColor(["#7986cb"])).toBe("#d50000");
    expect(nextColor(["#d50000", "#f4511e"])).toBe("#f6bf26");
  });
});

describe("splitRange", () => {
  it("keeps ranges of 62 days or less whole", () => {
    expect(splitRange("2026-09-01T00:00:00", "2026-11-02T00:00:00")).toEqual([{ start: "2026-09-01T00:00:00", end: "2026-11-02T00:00:00" }]);
  });
  it("splits longer ranges into consecutive chunks of at most 62 days", () => {
    const parts = splitRange("2026-01-01T00:00:00", "2026-06-30T00:00:00");
    expect(parts.length).toBe(3);
    expect(parts[0]).toEqual({ start: "2026-01-01T00:00:00", end: "2026-03-04T00:00:00" });
    expect(parts[1].start).toBe("2026-03-04T00:00:00");
    expect(parts[2].end).toBe("2026-06-30T00:00:00");
    for (const p of parts) expect((Date.parse(`${p.end}Z`) - Date.parse(`${p.start}Z`)) / 86_400_000).toBeLessThanOrEqual(62);
  });
  it("returns nothing for an empty range", () => {
    expect(splitRange("2026-01-01T00:00:00", "2026-01-01T00:00:00")).toEqual([]);
  });
});

describe("groupCalendars", () => {
  const mine: GraphCalendar[] = [
    { id: "a", name: "Calendar", isDefaultCalendar: true, owner: { address: "me@lyzr.ai", name: "Me" } },
    { id: "b", name: "Projects", owner: { address: "ME@lyzr.ai" } },
    { id: "c", name: "Siva", owner: { address: "siva@lyzr.ai", name: "Siva Surendira" } },
  ];
  const groups = [
    { id: "g1", name: "My Calendars", calendars: mine.slice(0, 2) },
    { id: "g2", name: "Other Calendars", calendars: [{ id: "d", name: "Holidays", owner: { address: "me@lyzr.ai" } }, { id: "e", name: "Team", owner: { address: "ani@lyzr.ai", name: "Ani" } }] },
  ];
  it("splits my calendars from the ones shared to me or in other groups", () => {
    const r = groupCalendars(mine, groups, "me@lyzr.ai");
    expect(r.mine.map((c) => c.id)).toEqual(["a", "b"]);
    expect(r.other.map((o) => o.cal.id)).toEqual(["c", "d", "e"]);
    expect(r.other[0]).toMatchObject({ groupName: "Shared with me", ownerName: "Siva Surendira" });
    expect(r.other[2]).toMatchObject({ groupId: "g2", groupName: "Other Calendars", ownerName: "Ani" });
  });
  it("files my own calendars under Mine when the UPN differs from the primary SMTP (canShare / default owner)", () => {
    // UPN kailash.gm@lyzr.com, calendars owned by the primary SMTP kailash@lyzr.ai.
    const list: GraphCalendar[] = [
      { id: "a", name: "Calendar", isDefaultCalendar: true, owner: { address: "kailash@lyzr.ai" } },
      { id: "b", name: "Birthdays", canShare: true, owner: { address: "kailash@lyzr.ai" } },
      { id: "c", name: "Projects", owner: { address: "Kailash@lyzr.ai" } },
      { id: "d", name: "Siva", canShare: false, owner: { address: "siva@lyzr.ai", name: "Siva" } },
    ];
    const r = groupCalendars(list, [], "kailash.gm@lyzr.com");
    expect(r.mine.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(r.other.map((o) => o.cal.id)).toEqual(["d"]);
    // canShare wins even when the owner address is somebody else's alias.
    const r2 = groupCalendars([{ id: "x", name: "Team", canShare: true, owner: { address: "other@lyzr.ai" } }], [], "me@lyzr.com");
    expect(r2.mine.map((c) => c.id)).toEqual(["x"]);
  });
  it("falls back to the default calendar's owner when the signed-in address is unknown", () => {
    const r = groupCalendars(mine, [], undefined);
    expect(r.mine.map((c) => c.id)).toEqual(["a", "b"]);
    expect(r.other.map((o) => o.cal.id)).toEqual(["c"]);
  });
});

describe("mock: groups, shared calendar, getSchedule items, people search", () => {
  beforeEach(() => resetCalendarMock());

  it("serves calendar groups and the shared calendar in Other Calendars", () => {
    const g = handleCalendar("GET", u("/me/calendarGroups"), undefined) as { value: { id: string; name: string }[] };
    expect(g.value.map((x) => x.name)).toEqual(["My Calendars", "Other Calendars"]);
    const c = handleCalendar("GET", u("/me/calendarGroups/cg-other/calendars"), undefined) as { value: GraphCalendar[] };
    expect(c.value[0]).toMatchObject({ name: "Siva Surendira", canEdit: false });
  });

  it("exposes Siva's calendarView but denies everyone else's", () => {
    const from = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const r = handleCalendar("GET", u(`/users/siva@lyzr.ai/calendarView?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}`), undefined) as { value: { subject: string }[] };
    expect(r.value.some((e) => e.subject === "Board prep")).toBe(true);
    expect(() => handleCalendar("GET", u(`/users/ani.sharma@lyzr.ai/calendarView?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}`), undefined)).toThrow(/ErrorAccessDenied/);
  });

  it("returns scheduleItems with subjects for Lyzr people and status-only for external ones", () => {
    const from = new Date();
    from.setDate(from.getDate() - from.getDay());
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 7 * 86_400_000);
    const body = { schedules: ["ani.sharma@lyzr.ai", "priya.raman@accenture.com", "not-an-address"], startTime: { dateTime: from.toISOString(), timeZone: "UTC" }, endTime: { dateTime: to.toISOString(), timeZone: "UTC" }, availabilityViewInterval: 30 };
    const r = handleCalendar("POST", u("/me/calendar/getSchedule"), body) as { value: { scheduleId: string; scheduleItems: { subject?: string; status: string }[]; error?: { message: string } }[] };
    expect(r.value[0].scheduleItems.length).toBeGreaterThan(0);
    expect(r.value[0].scheduleItems.every((i) => !!i.subject)).toBe(true);
    expect(r.value[1].scheduleItems.every((i) => !i.subject)).toBe(true);
    expect(r.value[2].error?.message).toMatch(/SMTP/);
    // Deterministic
    const again = handleCalendar("POST", u("/me/calendar/getSchedule"), body) as typeof r;
    expect(again.value[0].scheduleItems).toEqual(r.value[0].scheduleItems);
  });

  it("suggests Lyzr people for 'ani' from /me/people and /users", () => {
    const p = handleCalendar("GET", u('/me/people?$search="ani"&$top=10'), undefined) as { value: { displayName: string; jobTitle: string }[] };
    expect(p.value.map((x) => x.displayName)).toEqual(expect.arrayContaining(["Anirudh Narayan", "Ani Sharma"]));
    const usersUrl = `/users?$search=${encodeURIComponent('"displayName:ani" OR "mail:ani"')}&$select=id,displayName,mail,userPrincipalName,jobTitle&$top=10&$count=true`;
    const d = handleCalendar("GET", u(usersUrl), undefined) as { value: { displayName: string; jobTitle: string; mail: string }[] };
    expect(d.value.find((x) => x.displayName === "Anirudh Narayan")?.jobTitle).toBe("GSI Partnerships Lead");
    expect(d.value.every((x) => /ani/i.test(x.displayName) || /ani/i.test(x.mail))).toBe(true);
  });
});
