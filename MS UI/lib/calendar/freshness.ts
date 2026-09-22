// The freshness contract for the calendar: the UI is a front end for
// Microsoft, so every action refetches server truth immediately and once more
// a moment later (Outlook applies rules, provisions Teams meetings and updates
// its indexes asynchronously), and the visible tab polls for changes.
//
// Pure scheduling helpers live here so they can be tested with fake timers;
// the React hooks that use them are in hooks.ts.
import { toWallInZone } from "./time";
import type { CalEvent, GraphEvent } from "./types";

export const POLL_INTERVAL_MS = 15_000; // delta poll while the tab is visible
export const SAFETY_INTERVAL_MS = 120_000; // full calendarView refetch, catches non-default calendars
export const SETTLE_DELAY_MS = 2_500; // second refetch after a write
export const LATE_SETTLE_DELAY_MS = 8_000; // third refetch when the second still disagrees
export const JITTER_RATIO = 0.2; // ±10 % around the interval so many tabs do not tick together
export const GRACE_MS = 12_000; // how long a confirmed write outranks a lagging server index

// A jittered delay: base ± 10 %. `rand` is injectable for tests.
export function jittered(base: number, rand: () => number = Math.random): number {
  const r = Math.min(1, Math.max(0, rand()));
  return Math.round(base * (1 - JITTER_RATIO / 2 + r * JITTER_RATIO));
}

export type Poller = {
  start(): void;
  stop(): void;
  // visibilitychange -> visible, window focus, or a manual refresh: run now
  // (when visible) and restart the cadence from now.
  wake(): void;
  // Restart the cadence from now without running (the caller already refetched).
  resume(): void;
  isScheduled(): boolean;
};

export type PollerOptions = {
  intervalMs: number;
  run: () => unknown;
  isVisible: () => boolean;
  rand?: () => number;
  // Delay before the first run (default: one jittered interval).
  initialDelayMs?: number;
};

// Runs `run` every jittered interval while `isVisible()`; a tick that finds the
// tab hidden does not reschedule (the poller pauses) until wake() is called.
// Overlapping runs never happen: a tick that lands while one is in flight
// only reschedules.
export function createVisiblePoller(o: PollerOptions): Poller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;
  let running = false;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const schedule = (ms: number) => {
    clear();
    timer = setTimeout(() => void tick(), ms);
  };
  const tick = async () => {
    timer = null;
    if (stopped) return;
    if (!o.isVisible()) return; // paused; wake() resumes
    if (!running) {
      running = true;
      try {
        await o.run();
      } catch {
        // best effort; the next tick retries
      } finally {
        running = false;
      }
    }
    if (!stopped && !timer && o.isVisible()) schedule(jittered(o.intervalMs, o.rand));
  };
  return {
    start() {
      stopped = false;
      schedule(o.initialDelayMs ?? jittered(o.intervalMs, o.rand));
    },
    stop() {
      stopped = true;
      clear();
    },
    wake() {
      if (stopped) return;
      clear();
      void tick();
    },
    resume() {
      if (stopped || !o.isVisible()) return;
      schedule(jittered(o.intervalMs, o.rand));
    },
    isScheduled: () => timer !== null,
  };
}

// Runs `fn` now and again after each delay (default: once more at 2.5 s).
// Returns a cancel function.
export function scheduleSettle(fn: () => unknown, delays: number[] = [0, SETTLE_DELAY_MS]): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const d of delays) {
    if (d <= 0) void fn();
    else timers.push(setTimeout(() => void fn(), d));
  }
  return () => timers.forEach(clearTimeout);
}

// Refetch now, again at 2.5 s, and if `verify` still disagrees with what the
// user did, once more at 8 s before `onStillWrong` explains it. `refetch`
// resolves when the server data is back in the cache.
export function settleAndVerify(refetch: () => Promise<unknown>, verify?: () => boolean, onStillWrong?: () => void): () => void {
  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  void refetch();
  timers.push(
    setTimeout(() => {
      if (cancelled) return;
      void refetch().then(() => {
        if (cancelled || !verify || verify()) return;
        timers.push(
          setTimeout(() => {
            if (cancelled) return;
            void refetch().then(() => {
              if (!cancelled && !verify()) onStillWrong?.();
            });
          }, LATE_SETTLE_DELAY_MS - SETTLE_DELAY_MS),
        );
      });
    }, SETTLE_DELAY_MS),
  );
  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
  };
}

// "Updated 12s ago" for the top bar.
export function formatUpdated(ageMs: number | null | undefined): string {
  if (ageMs == null || !Number.isFinite(ageMs)) return "Not updated yet";
  const s = Math.max(0, Math.floor(ageMs / 1000));
  if (s < 5) return "Updated just now";
  if (s < 60) return `Updated ${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `Updated ${m}m ago`;
  return `Updated ${Math.floor(m / 60)}h ago`;
}

// ---------- reconciling confirmed writes with a lagging server ----------
//
// A POST that returned 201 or a DELETE that returned 204 is server truth even
// when the next calendarView still shows the old state (Exchange indexes lag
// by a second or two). The ledger remembers those for GRACE_MS so a refetch
// in that window does not make a just-created event blink out or a deleted
// one pop back. After the grace period the server's answer is final and the
// 8 s verification toast explains any disagreement.

export type Ledger = { created: Map<string, { ev: CalEvent; until: number }>; removed: Map<string, number> };

export function createLedger(): Ledger {
  return { created: new Map(), removed: new Map() };
}

export function noteCreated(l: Ledger, ev: CalEvent, now = Date.now(), graceMs = GRACE_MS) {
  l.removed.delete(ev.id);
  l.created.set(ev.id, { ev, until: now + graceMs });
}

export function noteRemoved(l: Ledger, id: string, now = Date.now(), graceMs = GRACE_MS) {
  l.created.delete(id);
  l.removed.set(id, now + graceMs);
}

export function forget(l: Ledger, id: string) {
  l.created.delete(id);
  l.removed.delete(id);
}

export function prune(l: Ledger, now = Date.now()) {
  for (const [id, e] of l.created) if (e.until <= now) l.created.delete(id);
  for (const [id, until] of l.removed) if (until <= now) l.removed.delete(id);
}

// Whether an event belongs in a view of [start, end) wall dates in `tz` over `ids`.
export function expectedInView(ev: CalEvent, tz: string, start: string, end: string, ids: string[]): boolean {
  if (!ids.includes(ev.calendarId)) return false;
  if (!ev.start || !ev.end) return false;
  const s = toWallInZone(ev.start, tz, !!ev.isAllDay);
  const e = toWallInZone(ev.end, tz, !!ev.isAllDay);
  return s < end && e > start;
}

// Server list -> list the user should see: recently removed rows dropped,
// recently created rows present. `pending` names the ids where the server
// still disagrees with the write (the verification step reads it). Expired
// entries are pruned first.
export function applyLedger(l: Ledger, list: CalEvent[], view: { tz: string; start: string; end: string; ids: string[] }, now = Date.now()): { events: CalEvent[]; pending: string[] } {
  prune(l, now);
  if (!l.created.size && !l.removed.size) return { events: list, pending: [] };
  const pending: string[] = [];
  const out = list.filter((ev) => {
    const gone = l.removed.has(ev.id) || (!!ev.seriesMasterId && l.removed.has(ev.seriesMasterId));
    if (gone) pending.push(ev.id);
    return !gone;
  });
  for (const { ev } of l.created.values()) {
    if (out.some((x) => x.id === ev.id)) continue;
    if (expectedInView(ev, view.tz, view.start, view.end, view.ids)) {
      out.push(ev);
      pending.push(ev.id);
    }
  }
  return { events: out, pending };
}

// ---------- delta polling ----------

// The fields a delta item is compared on. Our own writes come back through
// the delta too; when the cache already shows them there is nothing to refetch.
export function eventSignature(ev: GraphEvent): string {
  return JSON.stringify([
    ev.subject ?? "",
    ev.start?.dateTime ?? "",
    ev.end?.dateTime ?? "",
    !!ev.isAllDay,
    ev.location?.displayName ?? "",
    !!ev.isCancelled,
    ev.showAs ?? "",
    ev.sensitivity ?? "",
    ev.responseStatus?.response ?? "",
    (ev.attendees ?? []).map((a) => `${a.emailAddress.address ?? ""}:${a.status?.response ?? ""}`).join(","),
    ev.onlineMeeting?.joinUrl ?? "",
    ev.recurrence ? JSON.stringify(ev.recurrence) : "",
  ]);
}

// True when a delta page carries something the cached views do not show yet:
// a removal of a cached event, an event we do not have, or one whose fields
// differ from the cached copy.
export function deltaChanged(cached: Map<string, GraphEvent>, items: GraphEvent[]): boolean {
  for (const it of items) {
    if (!it?.id) continue;
    const have = cached.get(it.id);
    if (it["@removed"]) {
      if (have) return true;
      continue;
    }
    if (!have) return true;
    if (eventSignature(have) !== eventSignature(it)) return true;
  }
  return false;
}
