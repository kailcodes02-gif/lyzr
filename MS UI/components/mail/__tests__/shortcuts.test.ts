import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isActivationKeyOnControl, isTypingTarget, shortcutFor, useMailShortcuts } from "../shortcuts";

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
  it("ignores typing targets and anything inside a dialog", () => {
    const input = document.createElement("input");
    expect(isTypingTarget(input)).toBe(true);
    const div = document.createElement("div");
    expect(isTypingTarget(div)).toBe(false);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const btn = document.createElement("button");
    dialog.appendChild(btn);
    expect(isTypingTarget(btn)).toBe(true);
  });
  it("recognises Enter/Space on activatable controls", () => {
    const button = document.createElement("button");
    const link = document.createElement("a");
    link.href = "#";
    const span = document.createElement("span");
    expect(isActivationKeyOnControl({ key: "Enter", target: button })).toBe(true);
    expect(isActivationKeyOnControl({ key: " ", target: link })).toBe(true);
    expect(isActivationKeyOnControl({ key: "Enter", target: span })).toBe(false);
    expect(isActivationKeyOnControl({ key: "e", target: button })).toBe(false);
  });
});

describe("useMailShortcuts", () => {
  const press = (target: EventTarget, key: string) => {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };
  it("never swallows Enter on a focused button or link, but still opens from the list", () => {
    const open = vi.fn();
    const archive = vi.fn();
    const { unmount } = renderHook(() => useMailShortcuts({ open, archive }));
    const button = document.createElement("button");
    document.body.appendChild(button);
    const e1 = press(button, "Enter");
    expect(e1.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
    // Single-letter shortcuts still work while a button happens to have focus.
    press(button, "e");
    expect(archive).toHaveBeenCalledTimes(1);
    const e2 = press(document.body, "Enter");
    expect(e2.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    button.remove();
    unmount();
  });
  it("leaves keys inside an open dialog and already-handled events alone", () => {
    const escape = vi.fn();
    const trash = vi.fn();
    const { unmount } = renderHook(() => useMailShortcuts({ escape, trash }));
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const btn = document.createElement("button");
    dialog.appendChild(btn);
    document.body.appendChild(dialog);
    press(btn, "Escape");
    press(btn, "#");
    expect(escape).not.toHaveBeenCalled();
    expect(trash).not.toHaveBeenCalled();
    const handled = new KeyboardEvent("keydown", { key: "#", bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(trash).not.toHaveBeenCalled();
    dialog.remove();
    unmount();
  });
});
