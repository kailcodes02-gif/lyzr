import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphError } from "@/lib/graph";
import { createRequestQueue, isThrottleError, MAX_IN_FLIGHT, THROTTLE_BACKOFF_MS, THROTTLE_PAUSE_MS } from "../queue";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [] }) }));

// A request whose completion the test controls.
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("calendar request queue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never runs more than maxInFlight requests at once and starts the rest in FIFO order", async () => {
    const q = createRequestQueue({ maxInFlight: 3 });
    const started: number[] = [];
    const gates = [0, 1, 2, 3, 4].map(() => deferred());
    const results = gates.map((g, i) =>
      q.run(() => {
        started.push(i);
        return g.promise;
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([0, 1, 2]);
    expect(q.inFlight()).toBe(3);
    expect(q.pending()).toBe(2);
    gates[1].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([0, 1, 2, 3]); // the oldest waiter took the freed slot
    expect(q.inFlight()).toBe(3);
    gates[0].resolve();
    gates[2].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([0, 1, 2, 3, 4]);
    gates[3].resolve();
    gates[4].resolve();
    await Promise.all(results);
    expect(q.inFlight()).toBe(0);
    expect(q.pending()).toBe(0);
  });

  it("frees the slot when a request fails and passes the error through", async () => {
    const q = createRequestQueue({ maxInFlight: 1 });
    const p = q.run(() => Promise.reject(new Error("boom")));
    await expect(p).rejects.toThrow("boom");
    expect(q.inFlight()).toBe(0);
    expect(q.isPaused()).toBe(false); // a plain failure is not a throttle
  });

  it("retries a 429 with 2 s / 4 s / 8 s backoff and gives up after three retries", async () => {
    const q = createRequestQueue({ maxInFlight: 2 });
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      throw new GraphError(429, "ApplicationThrottled", "Application is over its MailboxConcurrency limit.", "/me/calendarView");
    });
    const p = q.run(fn);
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(THROTTLE_BACKOFF_MS[0] - 1);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(THROTTLE_BACKOFF_MS[1]);
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(THROTTLE_BACKOFF_MS[2]);
    expect(calls).toBe(4);
    await expect(p).rejects.toMatchObject({ status: 429 });
    expect(q.inFlight()).toBe(0);
  });

  it("recovers when the retry succeeds and holds other queued requests during the backoff", async () => {
    const q = createRequestQueue({ maxInFlight: 3 });
    let first = 0;
    const throttled = q.run(async () => {
      first++;
      if (first === 1) throw new GraphError(429, "ApplicationThrottled", "throttled", "/a");
      return "ok";
    });
    await vi.advanceTimersByTimeAsync(0);
    const second = vi.fn(async () => "b");
    const p2 = q.run(second);
    await vi.advanceTimersByTimeAsync(0);
    expect(second).not.toHaveBeenCalled(); // the queue waits out the backoff before starting more work
    await vi.advanceTimersByTimeAsync(THROTTLE_BACKOFF_MS[0]);
    expect(await throttled).toBe("ok");
    expect(await p2).toBe("b");
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("pauses polling for 30 s after a throttle", async () => {
    const q = createRequestQueue({ maxInFlight: 1 });
    expect(q.isPaused()).toBe(false);
    expect(q.pausedUntil()).toBe(0);
    let n = 0;
    const p = q.run(async () => {
      n++;
      if (n === 1) throw new GraphError(429, "TooManyRequests", "slow down", "/x");
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(q.isPaused()).toBe(true);
    expect(q.pausedUntil()).toBe(Date.now() + THROTTLE_PAUSE_MS);
    await vi.advanceTimersByTimeAsync(THROTTLE_BACKOFF_MS[0]);
    await p;
    await vi.advanceTimersByTimeAsync(THROTTLE_PAUSE_MS - THROTTLE_BACKOFF_MS[0] - 1);
    expect(q.isPaused()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(q.isPaused()).toBe(false);
    q.reset();
    expect(q.pausedUntil()).toBe(0);
  });

  it("treats Graph's throttle codes as throttles, with a default limit of three in flight", () => {
    expect(MAX_IN_FLIGHT).toBe(3);
    expect(isThrottleError(new GraphError(429, "Throttled", "Gave up after retries", "/x"))).toBe(true);
    expect(isThrottleError(new GraphError(503, "ApplicationThrottled", "Application is over its MailboxConcurrency limit", "/x"))).toBe(true);
    expect(isThrottleError(new GraphError(404, "ErrorItemNotFound", "gone", "/x"))).toBe(false);
    expect(isThrottleError(new Error("network"))).toBe(false);
  });

  it("keeps FIFO order across many short requests", async () => {
    const q = createRequestQueue({ maxInFlight: 2 });
    const order: number[] = [];
    const all = Array.from({ length: 8 }, (_, i) =>
      q.run(async () => {
        order.push(i);
        await tick();
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    await Promise.all(all);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
