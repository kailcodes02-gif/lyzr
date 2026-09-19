import { describe, expect, it } from "vitest";
import { allDayExclusiveEnd, allDayInclusiveEnd, allDaySpanDays, rangeTitle, stepDate, toWallInZone, visibleRange, wallToOffsetIso } from "../time";

describe("time zone helpers", () => {
  it("converts a UTC Graph dateTime into the display zone wall clock", () => {
    expect(toWallInZone({ dateTime: "2026-09-21T04:30:00.0000000", timeZone: "UTC" }, "Asia/Kolkata")).toBe("2026-09-21T10:00:00");
    expect(toWallInZone({ dateTime: "2026-09-21T10:00:00.0000000", timeZone: "Asia/Kolkata" }, "Asia/Kolkata")).toBe("2026-09-21T10:00:00");
  });
  it("keeps all-day values as dates and never shifts them", () => {
    expect(toWallInZone({ dateTime: "2026-09-21T00:00:00.0000000", timeZone: "UTC" }, "America/Los_Angeles", true)).toBe("2026-09-21");
  });
  it("builds offset ISO strings for calendarView params", () => {
    expect(wallToOffsetIso("2026-09-21", "Asia/Kolkata")).toBe("2026-09-21T00:00:00+05:30");
    expect(wallToOffsetIso("2026-09-21T09:00:00", "UTC")).toBe("2026-09-21T09:00:00Z");
  });
});

describe("all-day exclusive end", () => {
  it("round-trips inclusive and exclusive ends", () => {
    expect(allDayInclusiveEnd("2026-09-22")).toBe("2026-09-21");
    expect(allDayExclusiveEnd("2026-09-21")).toBe("2026-09-22");
    expect(allDaySpanDays("2026-09-21", "2026-09-22")).toBe(1);
    expect(allDaySpanDays("2026-09-21", "2026-09-24")).toBe(3);
  });
});

describe("visible ranges", () => {
  it("week starts on the configured day", () => {
    expect(visibleRange("week", "2026-09-23", 0)).toEqual({ start: "2026-09-20", end: "2026-09-27" });
    expect(visibleRange("week", "2026-09-23", 1)).toEqual({ start: "2026-09-21", end: "2026-09-28" });
  });
  it("month covers whole weeks", () => {
    expect(visibleRange("month", "2026-09-15", 0)).toEqual({ start: "2026-08-30", end: "2026-10-04" });
  });
  it("steps by view unit and titles ranges", () => {
    expect(stepDate("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(stepDate("4day", "2026-09-20", -1)).toBe("2026-09-16");
    expect(rangeTitle("month", "2026-09-20", 0)).toBe("September 2026");
    expect(rangeTitle("week", "2026-09-30", 0)).toBe("Sep 27 to Oct 3, 2026");
  });
});
