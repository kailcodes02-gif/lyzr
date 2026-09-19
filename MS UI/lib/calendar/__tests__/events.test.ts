import { describe, expect, it } from "vitest";
import { groupByDay, matchesSearch, normalise, toFcEvent, type WallEvent } from "../events";
import type { CalEvent } from "../types";

const base: CalEvent = {
  id: "1",
  calendarId: "c",
  subject: "Accenture QBR prep",
  start: { dateTime: "2026-09-21T04:30:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-09-21T05:30:00.0000000", timeZone: "UTC" },
  attendees: [{ emailAddress: { name: "Priya Raman", address: "priya.raman@accenture.com" } }],
};

describe("event helpers", () => {
  it("normalises into the display zone and maps to FullCalendar input", () => {
    const w = normalise(base, "Asia/Kolkata");
    expect(w.startWall).toBe("2026-09-21T10:00:00");
    const fc = toFcEvent({ ...w, showAs: "tentative", sensitivity: "private" }, { id: "c", name: "Calendar", color: "lightGreen" });
    expect(fc.color).toBe("#33b679");
    expect(fc.classNames).toContain("msui-ev-tentative");
    expect(fc.start).toBe("2026-09-21T10:00:00");
  });
  it("searches subject and attendees", () => {
    const w = normalise(base, "UTC");
    expect(matchesSearch(w, "priya")).toBe(true);
    expect(matchesSearch(w, "qbr")).toBe(true);
    expect(matchesSearch(w, "wipro")).toBe(false);
  });
  it("groups by day, spreading multi-day all-day events", () => {
    const a: WallEvent = { ...normalise(base, "UTC") };
    const b: WallEvent = normalise({ ...base, id: "2", subject: "Summit", isAllDay: true, start: { dateTime: "2026-09-22T00:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-09-24T00:00:00.0000000", timeZone: "UTC" } }, "UTC");
    const g = groupByDay([a, b], "2026-09-20", "2026-09-27");
    expect(g.map((x) => x.day)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23"]);
    expect(g[1].events[0].subject).toBe("Summit");
  });
});
