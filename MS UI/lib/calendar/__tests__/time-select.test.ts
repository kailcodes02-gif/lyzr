import { describe, expect, it } from "vitest";
import { durationLabel, endOptions, fmt12 } from "@/components/calendar/time-select";

describe("Google-style time pickers", () => {
  it("formats 12-hour labels like Google (8:00pm, 12:00am)", () => {
    expect(fmt12("20:00")).toBe("8:00pm");
    expect(fmt12("00:15")).toBe("12:15am");
    expect(fmt12("12:00")).toBe("12:00pm");
    expect(fmt12("09:05")).toBe("9:05am");
  });

  it("names durations: 30 mins, 1 hr, 1.5 hrs, 2 hrs", () => {
    expect(durationLabel(30)).toBe("30 mins");
    expect(durationLabel(45)).toBe("45 mins");
    expect(durationLabel(60)).toBe("1 hr");
    expect(durationLabel(90)).toBe("1.5 hrs");
    expect(durationLabel(120)).toBe("2 hrs");
  });

  it("end options step by 15 minutes from the start and stay on the start's day", () => {
    const opts = endOptions("2026-09-30T20:00");
    expect(opts[0]).toEqual({ wall: "2026-09-30T20:15", minutes: 15 });
    expect(opts.some((o) => o.wall === "2026-09-30T21:00" && o.minutes === 60)).toBe(true);
    // 20:00 start: the day ends before the 12-hour cap.
    expect(opts[opts.length - 1].wall.slice(0, 10)).toBe("2026-09-30");
    expect(opts[opts.length - 1].wall).toBe("2026-09-30T23:45");
  });

  it("a morning start caps at 12 hours", () => {
    const opts = endOptions("2026-09-30T08:00");
    expect(opts[opts.length - 1]).toEqual({ wall: "2026-09-30T20:00", minutes: 720 });
  });
});
