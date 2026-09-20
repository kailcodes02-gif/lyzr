import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyLedger,
  createLedger,
  createVisiblePoller,
  deltaChanged,
  formatUpdated,
  jittered,
  JITTER_RATIO,
  LATE_SETTLE_DELAY_MS,
  noteCreated,
  noteRemoved,
  POLL_INTERVAL_MS,
  scheduleSettle,
  SETTLE_DELAY_MS,
  settleAndVerify,
} from "../freshness";
import type { CalEvent } from "../types";

describe("jittered", () => {
  it("stays within ±10 % of the base for any random draw", () => {
    const lo = POLL_INTERVAL_MS * (1 - JITTER_RATIO / 2);
    const hi = POLL_INTERVAL_MS * (1 + JITTER_RATIO / 2);
    expect(jittered(POLL_INTERVAL_MS, () => 0)).toBe(lo);
    expect(jittered(POLL_INTERVAL_MS, () => 1)).toBe(hi);
    for (let i = 0; i < 200; i++) {
      const v = jittered(POLL_INTERVAL_MS);
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
    // never faster than 90 % of the interval, so mock mode never polls below 13.5 s
    expect(jittered(POLL_INTERVAL_MS, () => -5)).toBe(lo);
  });
});

describe("createVisiblePoller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs every jittered interval while visible and stops cleanly", async () => {
    const run = vi.fn();
    const p = createVisiblePoller({ intervalMs: 15_000, run, isVisible: () => true, rand: () => 0.5, initialDelayMs: 1000 });
    p.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(3);
    p.stop();
    expect(p.isScheduled()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses while hidden and runs at once on wake", async () => {
    let visible = true;
    const run = vi.fn();
    const p = createVisiblePoller({ intervalMs: 15_000, run, isVisible: () => visible, rand: () => 0.5, initialDelayMs: 0 });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    visible = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(1); // the tick found the tab hidden
    expect(p.isScheduled()).toBe(false); // and did not reschedule: no polling in the background
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(1);
    visible = true;
    p.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(p.isScheduled()).toBe(true); // cadence resumed
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(3);
    p.stop();
  });

  it("wake() while hidden does nothing, and never overlaps a run in flight", async () => {
    let visible = false;
    let release: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((r) => (release = r)));
    const p = createVisiblePoller({ intervalMs: 15_000, run, isVisible: () => visible, rand: () => 0.5, initialDelayMs: 0 });
    p.start();
    p.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();
    visible = true;
    p.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    p.wake(); // still running: no second concurrent call
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.isScheduled()).toBe(true);
    p.stop();
  });

  it("resume() restarts the cadence without an immediate run, only while visible", async () => {
    let visible = true;
    const run = vi.fn();
    const p = createVisiblePoller({ intervalMs: 15_000, run, isVisible: () => visible, rand: () => 0.5, initialDelayMs: 0 });
    p.start();
    await vi.advanceTimersByTimeAsync(0);
    visible = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(p.isScheduled()).toBe(false);
    p.resume(); // still hidden: stays paused
    expect(p.isScheduled()).toBe(false);
    visible = true;
    p.resume();
    expect(run).toHaveBeenCalledTimes(1);
    expect(p.isScheduled()).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("uses one jittered interval as the first delay by default", () => {
    const p = createVisiblePoller({ intervalMs: 15_000, run: () => {}, isVisible: () => true, rand: () => 0 });
    p.start();
    expect(p.isScheduled()).toBe(true);
    p.stop();
  });
});

describe("scheduleSettle / settleAndVerify", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("refetches immediately and once more at 2.5 s", async () => {
    const fn = vi.fn();
    const cancel = scheduleSettle(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS - 1);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    cancel();
  });

  it("cancel drops the pending second refetch", async () => {
    const fn = vi.fn();
    const cancel = scheduleSettle(fn);
    cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("settleAndVerify stops after the second refetch when the server agrees", async () => {
    const refetch = vi.fn(() => Promise.resolve());
    const wrong = vi.fn();
    settleAndVerify(refetch, () => true, wrong);
    expect(refetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS);
    expect(refetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(LATE_SETTLE_DELAY_MS);
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(wrong).not.toHaveBeenCalled();
  });

  it("settleAndVerify refetches a third time at 8 s and then explains when the server still disagrees", async () => {
    const refetch = vi.fn(() => Promise.resolve());
    const wrong = vi.fn();
    let ok = false;
    settleAndVerify(refetch, () => ok, wrong);
    await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS);
    expect(refetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(LATE_SETTLE_DELAY_MS - SETTLE_DELAY_MS - 1);
    expect(refetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(refetch).toHaveBeenCalledTimes(3);
    expect(wrong).toHaveBeenCalledTimes(1);
    // and when the third refetch fixes it, no toast
    const wrong2 = vi.fn();
    const refetch2 = vi.fn(() => Promise.resolve());
    ok = false;
    settleAndVerify(
      refetch2,
      () => {
        if (refetch2.mock.calls.length >= 3) ok = true;
        return ok;
      },
      wrong2,
    );
    await vi.advanceTimersByTimeAsync(LATE_SETTLE_DELAY_MS + 10);
    expect(refetch2).toHaveBeenCalledTimes(3);
    expect(wrong2).not.toHaveBeenCalled();
  });
});

describe("formatUpdated", () => {
  it("renders seconds, minutes, hours", () => {
    expect(formatUpdated(null)).toBe("Not updated yet");
    expect(formatUpdated(1200)).toBe("Updated just now");
    expect(formatUpdated(12_400)).toBe("Updated 12s ago");
    expect(formatUpdated(3 * 60_000 + 5000)).toBe("Updated 3m ago");
    expect(formatUpdated(2 * 3_600_000)).toBe("Updated 2h ago");
  });
});

const ev = (id: string, calendarId = "c", start = "2026-09-21T10:00:00", end = "2026-09-21T11:00:00", extra: Partial<CalEvent> = {}): CalEvent => ({
  id,
  calendarId,
  subject: id,
  start: { dateTime: start, timeZone: "UTC" },
  end: { dateTime: end, timeZone: "UTC" },
  ...extra,
});
const view = { tz: "UTC", start: "2026-09-20", end: "2026-09-27", ids: ["c"] };

describe("ledger: confirmed writes outrank a lagging server list, then expire", () => {
  it("keeps a just-created event that the server list does not show yet, flagged pending", () => {
    const l = createLedger();
    noteCreated(l, ev("new"), 1000);
    const r = applyLedger(l, [ev("a")], view, 2000);
    expect(r.events.map((e) => e.id)).toEqual(["a", "new"]);
    expect(r.pending).toEqual(["new"]);
    // once the server lists it, nothing is pending
    const r2 = applyLedger(l, [ev("a"), ev("new")], view, 3000);
    expect(r2.events.map((e) => e.id)).toEqual(["a", "new"]);
    expect(r2.pending).toEqual([]);
  });
  it("does not inject a created event into a view it does not belong to", () => {
    const l = createLedger();
    noteCreated(l, ev("new", "other"), 1000);
    noteCreated(l, ev("far", "c", "2026-10-05T10:00:00", "2026-10-05T11:00:00"), 1000);
    expect(applyLedger(l, [ev("a")], view, 2000).events.map((e) => e.id)).toEqual(["a"]);
  });
  it("drops a removed event (and its occurrences) that the server still returns", () => {
    const l = createLedger();
    noteRemoved(l, "gone", 1000);
    const r = applyLedger(l, [ev("a"), ev("gone"), ev("occ", "c", undefined, undefined, { seriesMasterId: "gone" })], view, 2000);
    expect(r.events.map((e) => e.id)).toEqual(["a"]);
    expect(r.pending).toEqual(["gone", "occ"]);
  });
  it("lets the server win after the grace period", () => {
    const l = createLedger();
    noteCreated(l, ev("new"), 1000, 5000);
    noteRemoved(l, "gone", 1000, 5000);
    const r = applyLedger(l, [ev("gone")], view, 6001);
    expect(r.events.map((e) => e.id)).toEqual(["gone"]);
    expect(r.pending).toEqual([]);
    expect(l.created.size + l.removed.size).toBe(0);
  });
});

describe("deltaChanged", () => {
  const cached = new Map([["a", ev("a")], ["b", ev("b")]]);
  it("ignores items the cache already shows (our own writes coming back)", () => {
    expect(deltaChanged(cached, [ev("a"), ev("b")])).toBe(false);
    expect(deltaChanged(cached, [])).toBe(false);
  });
  it("reports a new event, a removal of a cached one, or a changed field", () => {
    expect(deltaChanged(cached, [ev("c")])).toBe(true);
    expect(deltaChanged(cached, [{ ...ev("a"), "@removed": { reason: "deleted" } }])).toBe(true);
    expect(deltaChanged(cached, [{ ...ev("z"), "@removed": { reason: "deleted" } }])).toBe(false);
    expect(deltaChanged(cached, [ev("a", "c", "2026-09-21T12:00:00")])).toBe(true);
    expect(deltaChanged(cached, [{ ...ev("a"), onlineMeeting: { joinUrl: "https://teams.microsoft.com/x" } }])).toBe(true);
  });
});
