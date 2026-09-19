import { describe, expect, it } from "vitest";
import { parseUrlState, serializeUrlState } from "../url-state";

describe("calendar URL state", () => {
  it("parses and validates query params", () => {
    expect(parseUrlState("?view=month&date=2026-10-01&e=abc&cal=a,b")).toEqual({ view: "month", date: "2026-10-01", eventId: "abc", calendars: ["a", "b"], q: "" });
    expect(parseUrlState("?view=bogus&date=nope")).toMatchObject({ view: "week", date: null, eventId: null, calendars: null });
  });
  it("omits defaults when serialising", () => {
    expect(serializeUrlState({ view: "week", date: "2026-09-20" }, { date: "2026-09-20" })).toBe("");
    expect(serializeUrlState({ view: "4day", date: "2026-09-25", eventId: "x" }, { date: "2026-09-20" })).toBe("?view=4day&date=2026-09-25&e=x");
  });
});
