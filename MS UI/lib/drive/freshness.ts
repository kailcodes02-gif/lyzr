// Freshness for OneDrive. The UI is a front end for Microsoft: every action
// calls Graph, shows its result at once, then refetches server truth when the
// call settles and once more shortly after (OneDrive indexes asynchronously),
// and the delta feed is polled while the tab is visible. Pure scheduling,
// no React, so the timing rules can be tested with fake timers.

// Second refetch after a mutation settles: long enough for Graph's delta and
// search indexes to catch up with the write.
export const SETTLE_REFRESH_MS = 2500;
// Delta polling while the tab is visible. Never faster than this in any mode.
export const POLL_INTERVAL_MS = 30_000;
// +-20 %: many open tabs must not hit Graph in lockstep.
export const POLL_JITTER = 0.2;
// A focus straight after a visibility change (or after a poll) is one event.
export const FOCUS_MIN_GAP_MS = 5_000;
// Thumbnail urls are pre-authenticated and short-lived.
export const THUMBNAIL_TTL_MS = 50 * 60_000;

export function jitteredDelay(base: number, jitter = POLL_JITTER, rand: () => number = Math.random): number {
  const spread = base * jitter;
  return Math.round(base - spread + rand() * 2 * spread);
}

// "just now" | "12s ago" | "3m ago" | "2h ago"
export function formatAgo(elapsedMs: number): string {
  const s = Math.max(0, Math.floor(elapsedMs / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// Runs `run("settled")` now and `run("late")` after SETTLE_REFRESH_MS.
// Returns a cancel for the late pass (unmount).
export function settleRefresh(run: (pass: "settled" | "late") => unknown, delayMs = SETTLE_REFRESH_MS): () => void {
  void run("settled");
  const t = setTimeout(() => void run("late"), delayMs);
  return () => clearTimeout(t);
}

type Doc = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
type Win = Pick<Window, "addEventListener" | "removeEventListener">;

export type PollingOptions = {
  run: () => unknown;
  intervalMs?: number;
  jitter?: number;
  minGapMs?: number;
  rand?: () => number;
  now?: () => number;
  doc?: Doc;
  win?: Win;
};

// Visible-tab polling with jittered timers. Hidden: no timer at all. Back to
// visible, or window focus: an immediate run unless one happened within
// minGapMs, then the timer restarts. Does not run at start (the caller has
// just loaded); returns the stop function, which clears every timer/listener.
export function startPolling(o: PollingOptions): () => void {
  const intervalMs = o.intervalMs ?? POLL_INTERVAL_MS;
  const jitter = o.jitter ?? POLL_JITTER;
  const minGapMs = o.minGapMs ?? FOCUS_MIN_GAP_MS;
  const rand = o.rand ?? Math.random;
  const now = o.now ?? Date.now;
  const doc = o.doc ?? (typeof document === "undefined" ? undefined : document);
  const win = o.win ?? (typeof window === "undefined" ? undefined : window);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let lastRun = now();

  const visible = () => !doc || doc.visibilityState !== "hidden";
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const fire = () => {
    lastRun = now();
    void o.run();
  };
  const schedule = () => {
    clear();
    if (stopped || !visible()) return;
    timer = setTimeout(() => {
      timer = undefined;
      fire();
      schedule();
    }, jitteredDelay(intervalMs, jitter, rand));
  };
  const kick = () => {
    if (stopped || !visible()) return;
    if (now() - lastRun >= minGapMs) fire();
    schedule();
  };
  const onVisibility = () => {
    if (visible()) kick();
    else clear();
  };
  const onFocus = () => kick();

  doc?.addEventListener("visibilitychange", onVisibility);
  win?.addEventListener("focus", onFocus);
  schedule();

  return () => {
    stopped = true;
    clear();
    doc?.removeEventListener("visibilitychange", onVisibility);
    win?.removeEventListener("focus", onFocus);
  };
}
