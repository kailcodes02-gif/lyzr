import { describe, expect, it } from "vitest";
import { defaultForm, describeRecurrence, fromGraphRecurrence, presetLabels, toGraphRecurrence } from "../recurrence";

const START = "2026-09-22"; // a Tuesday

describe("recurrence editor <-> Graph", () => {
  it("weekly preset maps to a weekly pattern on the start weekday", () => {
    const f = { ...defaultForm(START), preset: "weekly" as const };
    const g = toGraphRecurrence(f, START, "Asia/Kolkata")!;
    expect(g.pattern).toEqual({ type: "weekly", interval: 1, daysOfWeek: ["tuesday"], firstDayOfWeek: "sunday" });
    expect(g.range).toEqual({ type: "noEnd", startDate: START, recurrenceTimeZone: "Asia/Kolkata" });
    expect(fromGraphRecurrence(g, START).preset).toBe("weekly");
  });
  it("custom every 2 weeks on Mon/Wed ending after 6 round-trips", () => {
    const f = { ...defaultForm(START), preset: "custom" as const, interval: 2, unit: "week" as const, weekdays: ["monday", "wednesday"] as const, ends: "after" as const, count: 6 };
    const g = toGraphRecurrence({ ...f, weekdays: [...f.weekdays] }, START, "UTC")!;
    expect(g.pattern.interval).toBe(2);
    expect(g.pattern.daysOfWeek).toEqual(["monday", "wednesday"]);
    expect(g.range).toMatchObject({ type: "numbered", numberOfOccurrences: 6 });
    const back = fromGraphRecurrence(g, START);
    expect(back).toMatchObject({ preset: "custom", interval: 2, unit: "week", weekdays: ["monday", "wednesday"], ends: "after", count: 6 });
  });
  it("monthly on the Nth weekday, ending on a date", () => {
    const f = { ...defaultForm(START), preset: "custom" as const, unit: "month" as const, monthlyMode: "weekday" as const, ends: "on" as const, endDate: "2027-01-31" };
    const g = toGraphRecurrence(f, START, "UTC")!;
    expect(g.pattern).toEqual({ type: "relativeMonthly", interval: 1, daysOfWeek: ["tuesday"], index: "fourth" });
    expect(g.range).toMatchObject({ type: "endDate", endDate: "2027-01-31" });
    expect(fromGraphRecurrence(g, START)).toMatchObject({ unit: "month", monthlyMode: "weekday", ends: "on", endDate: "2027-01-31" });
  });
  it("weekdays preset and yearly preset", () => {
    const wd = toGraphRecurrence({ ...defaultForm(START), preset: "weekdays" }, START, "UTC")!;
    expect(wd.pattern.daysOfWeek).toHaveLength(5);
    expect(fromGraphRecurrence(wd, START).preset).toBe("weekdays");
    const y = toGraphRecurrence({ ...defaultForm(START), preset: "yearly" }, START, "UTC")!;
    expect(y.pattern).toEqual({ type: "absoluteYearly", interval: 1, dayOfMonth: 22, month: 9 });
    expect(fromGraphRecurrence(y, START).preset).toBe("yearly");
  });
  it("none maps to null and labels follow the start date", () => {
    expect(toGraphRecurrence(defaultForm(START), START, "UTC")).toBeNull();
    expect(presetLabels(START).find((p) => p.value === "weekly")?.label).toBe("Weekly on Tuesday");
    expect(describeRecurrence({ pattern: { type: "weekly", interval: 1, daysOfWeek: ["tuesday"] }, range: { type: "numbered", startDate: START, numberOfOccurrences: 4 } })).toBe("Weekly on Tuesday, 4 times");
  });
});
