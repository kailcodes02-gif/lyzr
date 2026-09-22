// One request queue for every calendar call to Graph.
//
// Outlook allows about four concurrent requests per mailbox per application;
// beyond that it answers 429 "ApplicationThrottled / MailboxConcurrency" and
// the calendars show "Could not load". Every calendar fetch (views, delta,
// getSchedule, shared calendars, reminders, time zones, single events) goes
// through `calendarQueue`, which keeps at most MAX_IN_FLIGHT requests running,
// starts the rest in FIFO order, retries a throttled request with a backoff
// (2 s, 4 s, 8 s; Retry-After is already honoured inside graphFetch), and
// pauses the pollers for THROTTLE_PAUSE_MS after any throttle.
//
// Pure factory + module singleton so the behaviour can be tested with fake timers.

export const MAX_IN_FLIGHT = 3;
export const THROTTLE_RETRIES = 3;
export const THROTTLE_BACKOFF_MS = [2_000, 4_000, 8_000];
export const THROTTLE_PAUSE_MS = 30_000;

export type QueueOptions = {
  maxInFlight?: number;
  retries?: number;
  backoffMs?: number[];
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type RequestQueue = {
  // Runs `fn` when a slot is free (FIFO). Throttled failures are retried.
  run<T>(fn: () => Promise<T>): Promise<T>;
  // Number of requests currently executing.
  inFlight(): number;
  // Number of requests waiting for a slot.
  pending(): number;
  // Timestamp until which pollers should stay quiet (0 when not throttled).
  pausedUntil(): number;
  // True while a recent throttle asks the pollers to hold off.
  isPaused(): boolean;
  // Test hook: forget any throttle state (queued and running requests are untouched).
  reset(): void;
};

const isThrottle = (e: unknown): boolean => {
  const err = e as { status?: number; code?: string; message?: string } | undefined;
  if (!err || typeof err !== "object") return false;
  if (err.status === 429) return true;
  return /throttl|MailboxConcurrency/i.test(`${err.code ?? ""} ${err.message ?? ""}`);
};
export const isThrottleError = isThrottle;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createRequestQueue(o: QueueOptions = {}): RequestQueue {
  const max = o.maxInFlight ?? MAX_IN_FLIGHT;
  const retries = o.retries ?? THROTTLE_RETRIES;
  const backoff = o.backoffMs ?? THROTTLE_BACKOFF_MS;
  const pauseMs = o.pauseMs ?? THROTTLE_PAUSE_MS;
  const sleep = o.sleep ?? defaultSleep;
  const now = o.now ?? Date.now;

  let active = 0;
  let paused = 0; // pollers hold off until this time
  let holdUntil = 0; // the queue itself waits before starting new work (backoff after a throttle)
  const waiting: (() => void)[] = [];

  const pump = () => {
    while (active < max && waiting.length) {
      const next = waiting.shift()!;
      active++;
      next();
    }
  };
  const acquire = () =>
    new Promise<void>((resolve) => {
      waiting.push(resolve);
      pump();
    });
  const release = () => {
    active--;
    pump();
  };

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      for (let attempt = 0; ; attempt++) {
        const wait = holdUntil - now();
        if (wait > 0) await sleep(wait);
        try {
          return await fn();
        } catch (e) {
          if (!isThrottle(e) || attempt >= retries) throw e;
          const delay = backoff[Math.min(attempt, backoff.length - 1)];
          paused = Math.max(paused, now() + pauseMs);
          holdUntil = Math.max(holdUntil, now() + delay);
        }
      }
    } finally {
      release();
    }
  };

  return {
    run,
    inFlight: () => active,
    pending: () => waiting.length,
    pausedUntil: () => (paused > now() ? paused : 0),
    isPaused: () => paused > now(),
    reset() {
      paused = 0;
      holdUntil = 0;
    },
  };
}

// The shared queue every calendar Graph call goes through.
export const calendarQueue: RequestQueue = createRequestQueue();

// Convenience wrapper: `queued(() => graphFetch(...))`.
export const queued = <T>(fn: () => Promise<T>): Promise<T> => calendarQueue.run(fn);
