import { beforeEach, describe, expect, it } from "vitest";
import { assignColors, contrastText, loadAssignedColors, mineColor, MINE_BLUES, OTHER_PALETTE, pickColor, saveAssignedColors } from "../colors";
import { normalise, toFcEvent, toFcPersonEvent } from "../events";
import { nextColor, PERSON_COLORS } from "../overlay";
import type { CalEvent } from "../types";

const BLUES = ["#1a73e8", "#4285f4", "#039be5", "#7986cb", "#3f51b5", "#a8c7fa"];

describe("palettes", () => {
  it("own calendars are Google blue, white text in light mode and dark text on the light-blue dark chip", () => {
    expect(mineColor(0)).toBe("#1a73e8");
    expect(mineColor(1)).toBe("#4285f4");
    expect(mineColor(2)).toBe(MINE_BLUES[0]); // cycles
    expect(contrastText(mineColor(0))).toBe("#ffffff");
    expect(mineColor(0, true)).toBe("#a8c7fa");
    expect(contrastText(mineColor(0, true))).toBe("#202124");
  });
  it("the palette for everyone else has no blue (peacock included) and colleagues share it", () => {
    for (const c of OTHER_PALETTE) expect(BLUES).not.toContain(c);
    expect(OTHER_PALETTE).toEqual(["#d50000", "#f4511e", "#f6bf26", "#0b8043", "#33b679", "#8e24aa", "#e67c73", "#616161"]);
    expect(PERSON_COLORS).toBe(OTHER_PALETTE);
  });
  it("pickColor hands out the first free colour, then the least used one", () => {
    expect(pickColor([])).toBe("#d50000");
    expect(pickColor(["#d50000"])).toBe("#f4511e");
    expect(nextColor(["#d50000", "#f4511e"])).toBe("#f6bf26");
    expect(pickColor([...OTHER_PALETTE])).toBe("#d50000");
    expect(pickColor([...OTHER_PALETTE, "#d50000"])).toBe("#f4511e");
    // a legacy blue in the taken list is simply not a palette colour
    expect(pickColor(["#7986cb"])).toBe("#d50000");
  });
});

describe("assignColors", () => {
  beforeEach(() => localStorage.clear());

  it("assigns by order of appearance, skips colours colleagues already use, and is stable", () => {
    const a = assignColors({}, ["shared-1", "group-2"], ["#d50000"]);
    expect(a).toEqual({ "shared-1": "#f4511e", "group-2": "#f6bf26" });
    // same input, same object (no churn)
    expect(assignColors(a, ["shared-1", "group-2"], ["#d50000"])).toBe(a);
    // a new calendar appears later: existing ones keep their colour
    const b = assignColors(a, ["group-2", "shared-1", "new-3"], ["#d50000"]);
    expect(b["shared-1"]).toBe("#f4511e");
    expect(b["group-2"]).toBe("#f6bf26");
    expect(b["new-3"]).toBe("#0b8043");
  });
  it("replaces a stored colour that is not in the palette", () => {
    expect(assignColors({ x: "#1a73e8" }, ["x"])).toEqual({ x: "#d50000" });
  });
  it("persists in localStorage and ignores junk", () => {
    saveAssignedColors({ a: "#8e24aa" });
    expect(loadAssignedColors()).toEqual({ a: "#8e24aa" });
    localStorage.setItem("msui.cal.colors", JSON.stringify({ a: "#8E24AA", b: "#1a73e8", c: 3 }));
    expect(loadAssignedColors()).toEqual({ a: "#8e24aa" });
    localStorage.setItem("msui.cal.colors", "not json");
    expect(loadAssignedColors()).toEqual({});
  });
});

describe("event chips use the resolved colour and keep their state styles", () => {
  const base: CalEvent = {
    id: "1",
    calendarId: "mine",
    subject: "Review",
    start: { dateTime: "2026-09-21T10:00:00", timeZone: "UTC" },
    end: { dateTime: "2026-09-21T11:00:00", timeZone: "UTC" },
  };
  it("renders an own-calendar event blue whatever Outlook says its calendar colour is", () => {
    const w = normalise(base, "UTC");
    const fc = toFcEvent({ ...w, showAs: "tentative", isCancelled: true, sensitivity: "private" }, { id: "mine", name: "Calendar", color: "lightGreen" }, mineColor(0));
    expect(fc.color).toBe("#1a73e8");
    expect(fc.contrastColor).toBe("#ffffff");
    const cls = fc.className.split(" ");
    expect(cls).toContain("msui-ev-tentative");
    expect(cls).toContain("msui-ev-cancelled");
    expect(fc.extendedProps.ev.sensitivity).toBe("private");
  });
  it("falls back to the Outlook colour when no resolved colour is given", () => {
    expect(toFcEvent(normalise(base, "UTC"), { id: "mine", name: "Calendar", color: "lightGreen" }).color).toBe("#33b679");
  });
  it("a colleague overlay keeps the person's palette colour", () => {
    const fc = toFcPersonEvent(normalise(base, "UTC"), { name: "Ani Sharma", email: "ani@lyzr.ai", color: "#8e24aa" });
    expect(fc.color).toBe("#8e24aa");
    expect(fc.className.split(" ")).toContain("msui-ev-colleague");
  });
});
