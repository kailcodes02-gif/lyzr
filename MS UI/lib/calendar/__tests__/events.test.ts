import { describe, expect, it } from "vitest";
import { chipKind, chipOuterClass, durationMinutes, groupByDay, isShortEvent, matchesSearch, normalise, toFcEvent, toFcPersonEvent, type WallEvent } from "../events";
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
    // FullCalendar v7 reads a single `className` string; `classNames` is silently dropped.
    expect(fc.className.split(" ")).toContain("msui-ev-tentative");
    expect(fc.className.split(" ")).toContain("msui-ev");
    expect((fc as unknown as { classNames?: unknown }).classNames).toBeUndefined();
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
  it("keeps timed events on the DST fall-back day (calendar-day arithmetic, not +24 h)", () => {
    // 2026-11-01 is the fall-back day in America/New_York: local midnight + 24 h is 23:00 the same day.
    const prevTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const w = normalise({ ...base, id: "dst", start: { dateTime: "2026-11-01T14:00:00", timeZone: "America/New_York" }, end: { dateTime: "2026-11-01T15:00:00", timeZone: "America/New_York" } }, "America/New_York");
      const g = groupByDay([w], "2026-10-25", "2026-11-08");
      expect(g.map((x) => x.day)).toEqual(["2026-11-01"]);
      const spring = normalise({ ...base, id: "dst2", start: { dateTime: "2026-03-08T14:00:00", timeZone: "America/New_York" }, end: { dateTime: "2026-03-08T15:00:00", timeZone: "America/New_York" } }, "America/New_York");
      expect(groupByDay([spring], "2026-03-01", "2026-03-15").map((x) => x.day)).toEqual(["2026-03-08"]);
    } finally {
      process.env.TZ = prevTz;
    }
  });
});

describe("event chips", () => {
  it("marks 15-minute events short so the grid gives them one 11 px line", () => {
    const w = normalise(base, "UTC");
    expect(durationMinutes(w)).toBe(60);
    expect(isShortEvent(w)).toBe(false);
    const short = normalise({ ...base, end: { dateTime: "2026-09-21T04:45:00.0000000", timeZone: "UTC" } }, "UTC");
    expect(isShortEvent(short)).toBe(true);
    expect(toFcEvent(short, undefined).className.split(" ")).toContain("msui-ev-short");
    expect(toFcEvent(w, undefined).className.split(" ")).not.toContain("msui-ev-short");
    expect(toFcPersonEvent(short, { name: "Siva", email: "siva@lyzr.ai", color: "#0b8043" }).className.split(" ")).toContain("msui-ev-short");
    // All-day events are never "short".
    expect(isShortEvent({ ...short, isAllDay: true })).toBe(false);
  });
  it("draws time-grid blocks as title-only blocks, month timed events as dot + title, all-day as rows", () => {
    expect(chipKind("timeGridWeek", false)).toBe("block");
    expect(chipKind("timeGridDay", true)).toBe("row");
    expect(chipKind("dayGridMonth", false)).toBe("dot");
    expect(chipKind("dayGridMonth", true)).toBe("row");
    expect(chipOuterClass("dot")).toBe("msui-ev-dot-event");
    expect(chipOuterClass("block")).toBe("msui-ev-solid");
    expect(chipOuterClass("row")).toBe("msui-ev-solid");
  });
  it("computes a readable text colour for every chip colour", () => {
    const w = normalise(base, "UTC");
    expect(toFcEvent(w, undefined, "#f6bf26").contrastColor).toBe("#202124"); // banana: dark text
    expect(toFcEvent(w, undefined, "#d50000").contrastColor).toBe("#ffffff"); // tomato: white text
    expect(toFcPersonEvent(w, { name: "Siva", email: "siva@lyzr.ai", color: "#a8c7fa" }).contrastColor).toBe("#202124");
  });
});
