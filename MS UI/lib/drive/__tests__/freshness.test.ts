import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOCUS_MIN_GAP_MS, formatAgo, jitteredDelay, POLL_INTERVAL_MS, POLL_JITTER, SETTLE_REFRESH_MS, settleRefresh, startPolling } from "../freshness";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("jitteredDelay", () => {
  it("stays within +-jitter of the base for every random value", () => {
    expect(jitteredDelay(30_000, 0.2, () => 0)).toBe(24_000);
    expect(jitteredDelay(30_000, 0.2, () => 1)).toBe(36_000);
    expect(jitteredDelay(30_000, 0.2, () => 0.5)).toBe(30_000);
    for (let i = 0; i < 200; i++) {
      const d = jitteredDelay(POLL_INTERVAL_MS, POLL_JITTER);
      expect(d).toBeGreaterThanOrEqual(POLL_INTERVAL_MS * (1 - POLL_JITTER));
      expect(d).toBeLessThanOrEqual(POLL_INTERVAL_MS * (1 + POLL_JITTER));
    }
  });
  it("never polls faster than 15 s (mock mode included)", () => {
    expect(POLL_INTERVAL_MS * (1 - POLL_JITTER)).toBeGreaterThanOrEqual(15_000);
  });
});

describe("settleRefresh", () => {
  it("refetches immediately and once more after the settle delay", () => {
    const run = vi.fn();
    settleRefresh(run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenLastCalledWith("settled");
    vi.advanceTimersByTime(SETTLE_REFRESH_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith("late");
  });
  it("cancel drops the late pass (unmount)", () => {
    const run = vi.fn();
    const cancel = settleRefresh(run);
    cancel();
    vi.advanceTimersByTime(SETTLE_REFRESH_MS * 2);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("startPolling", () => {
  it("does not run at start, then runs on every jittered interval while visible", () => {
    const run = vi.fn();
    const stop = startPolling({ run, rand: () => 0.5 });
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(POLL_INTERVAL_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 5);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("uses a fresh jittered delay for each tick, within bounds", () => {
    const run = vi.fn();
    const rands = [0, 1];
    let i = 0;
    const stop = startPolling({ run, rand: () => rands[i++ % rands.length] });
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 0.8);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 1.2 - 1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });
  it("pauses while hidden and refetches immediately when the tab is visible again", () => {
    const run = vi.fn();
    const stop = startPolling({ run, rand: () => 0.5 });
    setVisibility("hidden");
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
    expect(run).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(run).toHaveBeenCalledTimes(1);
    // ...and the interval restarts from that point.
    vi.advanceTimersByTime(POLL_INTERVAL_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });
  it("does not start a timer when created hidden", () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    const run = vi.fn();
    const stop = startPolling({ run });
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });
  it("refetches on window focus, but not twice within the minimum gap", () => {
    const run = vi.fn();
    const stop = startPolling({ run, rand: () => 0.5 });
    vi.advanceTimersByTime(FOCUS_MIN_GAP_MS);
    window.dispatchEvent(new Event("focus"));
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event("focus"));
    expect(run).toHaveBeenCalledTimes(1);
    // A visibility change right after a focus is the same event.
    setVisibility("hidden");
    setVisibility("visible");
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FOCUS_MIN_GAP_MS);
    window.dispatchEvent(new Event("focus"));
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });
  it("stop removes the listeners and every timer", () => {
    const run = vi.fn();
    const stop = startPolling({ run });
    stop();
    expect(vi.getTimerCount()).toBe(0);
    window.dispatchEvent(new Event("focus"));
    setVisibility("hidden");
    setVisibility("visible");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("formatAgo", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatAgo(0)).toBe("just now");
    expect(formatAgo(4_999)).toBe("just now");
    expect(formatAgo(12_000)).toBe("12s ago");
    expect(formatAgo(59_999)).toBe("59s ago");
    expect(formatAgo(3 * 60_000)).toBe("3m ago");
    expect(formatAgo(2 * 3_600_000)).toBe("2h ago");
  });
});
