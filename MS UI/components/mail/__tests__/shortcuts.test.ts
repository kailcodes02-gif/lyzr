import { describe, expect, it } from "vitest";
import { isTypingTarget, shortcutFor } from "../shortcuts";

const k = (key: string, shift = false) => ({ key, shiftKey: shift, metaKey: false, ctrlKey: false, altKey: false });

describe("shortcutFor", () => {
  it("maps Gmail keys", () => {
    expect(shortcutFor(k("j"))).toBe("next");
    expect(shortcutFor(k("e"))).toBe("archive");
    expect(shortcutFor(k("#", true))).toBe("trash");
    expect(shortcutFor(k("I", true))).toBe("markRead");
    expect(shortcutFor(k("/"))).toBe("search");
    expect(shortcutFor(k("Enter"))).toBe("open");
    expect(shortcutFor({ ...k("c"), metaKey: true })).toBeNull();
    expect(shortcutFor(k("z"))).toBeNull();
  });
  it("ignores typing targets", () => {
    const input = document.createElement("input");
    expect(isTypingTarget(input)).toBe(true);
    const div = document.createElement("div");
    expect(isTypingTarget(div)).toBe(false);
  });
});
