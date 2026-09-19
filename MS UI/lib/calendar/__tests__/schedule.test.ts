import { describe, expect, it } from "vitest";
import { freeSlots, parseAvailabilityView, slotsFor } from "../schedule";

describe("availabilityView", () => {
  it("parses the digit codes", () => {
    expect(parseAvailabilityView("01234")).toEqual(["free", "tentative", "busy", "oof", "workingElsewhere"]);
  });
  it("finds slots where everyone is free", () => {
    const s = [
      { scheduleId: "a", availabilityView: "0020" },
      { scheduleId: "b", availabilityView: "0100" },
    ];
    expect(freeSlots(s, 4)).toEqual([0, 3]);
    expect(freeSlots(s, 4, true)).toEqual([0, 1, 3]);
  });
  it("builds slot times", () => {
    const slots = slotsFor("2026-09-21T08:00:00", 30, 3);
    expect(slots.map((s) => s.start)).toEqual(["2026-09-21T08:00:00", "2026-09-21T08:30:00", "2026-09-21T09:00:00"]);
  });
});
