// Freshness for Outlook mail. The UI is a front end for Microsoft: every
// action calls Graph, shows its result at once, refetches server truth when
// the call settles and once more shortly after (Outlook applies rules, files
// sent mail and updates counts asynchronously), and the open view is polled
// while the tab is visible. Pure scheduling and key tables, no React, so the
// timing rules can be tested with fake timers.
import type { QueryKey } from "@tanstack/react-query";
import { isVirtualFolderKey } from "./logic";
import type { Message } from "./types";
import { labelFolderKey } from "./url";

// Second refetch after a mutation settles: Outlook's async work (rules,
// Sent Items, counts) is usually visible by then.
export const SETTLE_DELAY_MS = 2_500;
// Poll cadence while the tab is visible. Never faster than this in any mode.
export const POLL_INTERVAL_MS = 15_000;
// Added to every interval so many tabs do not hit Graph in lockstep.
export const POLL_JITTER_MS = 2_000;
// The list itself was just fetched at mount: the first round waits a little
// (and in real mode only primes the delta link when none is stored).
export const POLL_INITIAL_DELAY_MS = 6_000;
// A focus straight after a visibility change (or a poll) is one event.
export const WAKE_MIN_GAP_MS = 2_000;
// After a send, Sent Items is polled until the sent copy shows.
export const SENT_POLL_INTERVAL_MS = 2_000;
export const SENT_POLL_MAX_MS = 20_000;

// ---- Invalidation targets per action ----------------------------------------

export type ActionKind = "read" | "star" | "label" | "archive" | "trash" | "deleteForever" | "spam" | "inbox" | "move" | "folder" | "category" | "rules" | "presets" | "send" | "draft" | "undoSend";

export type ActionContext = {
  sourceFolders?: string[]; // folder keys the messages live in now (inbox, deleteditems, a custom id)
  destination?: string; // folder key the messages go to; defaults per kind
  labels?: string[]; // label names touched (their views are virtual)
  conversationIds?: string[];
  messageIds?: string[];
  cachedFolders?: string[]; // folder keys with a cached list; virtual ones are refetched on moves
  activeFolders?: string[]; // folder keys with a mounted list (the view on screen)
};

export const DESTINATION_OF: Partial<Record<ActionKind, string>> = {
  archive: "archive",
  trash: "deleteditems",
  spam: "junkemail",
  inbox: "inbox",
  send: "sentitems",
  draft: "drafts",
  undoSend: "drafts",
  folder: "deleteditems",
};

const MOVES = new Set<ActionKind>(["archive", "trash", "deleteForever", "spam", "inbox", "move", "folder"]);

export const listKey = (folder: string): QueryKey => ["mail", "list", folder];

// The query keys to refetch once an action settles: the source and
// destination folder lists, the folder counts, the Starred / label views the
// change shows in, the open thread and the touched messages. Ordered and
// de-duplicated so callers can fire them as one round.
export function refetchTargets(kind: ActionKind, ctx: ActionContext = {}): QueryKey[] {
  const out: QueryKey[] = [];
  const seen = new Set<string>();
  const add = (k: QueryKey) => {
    const s = JSON.stringify(k);
    if (seen.has(s)) return;
    seen.add(s);
    out.push(k);
  };
  if (kind === "presets") {
    add(["mail"]);
    return out;
  }
  const folders = new Set<string>(ctx.sourceFolders ?? []);
  const dest = ctx.destination ?? DESTINATION_OF[kind];
  if (dest) folders.add(dest);
  if (kind === "send") folders.add("drafts");
  if (kind === "star") folders.add("starred");
  if (kind === "rules") folders.add("inbox");
  for (const l of ctx.labels ?? []) folders.add(labelFolderKey(l));
  if (MOVES.has(kind)) for (const f of ctx.cachedFolders ?? []) if (isVirtualFolderKey(f)) folders.add(f);
  for (const f of ctx.activeFolders ?? []) folders.add(f);
  if (kind === "rules") add(["mail", "rules"]);
  if (kind === "category") {
    add(["mail", "categories"]);
    add(["mail", "rules"]);
  }
  if (kind === "folder") add(["mail", "childFolders"]);
  for (const f of folders) add(listKey(f));
  add(["mail", "folders"]);
  const convs = ctx.conversationIds ?? [];
  if (convs.length) for (const c of convs) add(["mail", "thread", c]);
  else if (kind !== "category" && kind !== "rules" && kind !== "folder") add(["mail", "thread"]);
  for (const id of ctx.messageIds ?? []) add(["mail", "message", id]);
  return out;
}

// ---- Settle: refetch now, verify, refetch again at 2.5 s --------------------

export type Invalidate = (key: QueryKey) => Promise<unknown>;

// Owns every timer it starts; dispose() (unmount) clears them so nothing
// fires into a dead tree. Shared by every mail hook of one QueryClient.
export class Settler {
  private timers = new Map<ReturnType<typeof setTimeout>, (elapsed: boolean) => void>();
  disposed = false;
  constructor(private invalidate: Invalidate) {}

  // Resolves when the first round of refetches has completed. `verify` runs
  // after each round with the server's data in the cache.
  settle(targets: QueryKey[], verify?: (round: "settled" | "late") => void): Promise<void> {
    const round = async (which: "settled" | "late") => {
      await Promise.all(targets.map((k) => this.invalidate(k).catch(() => undefined)));
      if (!this.disposed) verify?.(which);
    };
    const first = round("settled");
    void this.delay(SETTLE_DELAY_MS).then((elapsed) => (elapsed ? round("late") : undefined));
    return first;
  }

  // Resolves true after `ms`, false at once if disposed meanwhile.
  delay(ms: number): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        resolve(!this.disposed);
      }, ms);
      this.timers.set(t, resolve);
    });
  }

  // Pending delays resolve false at once, so a poll waiting on one exits.
  dispose() {
    this.disposed = true;
    for (const [t, resolve] of this.timers) {
      clearTimeout(t);
      resolve(false);
    }
    this.timers.clear();
  }
}

// ---- Sent Items poll ---------------------------------------------------------

export type PollUntilOptions = { intervalMs?: number; maxMs?: number; delay: (ms: number) => Promise<boolean>; now?: () => number };

// Calls `check` now and every `intervalMs` until it returns true or `maxMs`
// has passed. Resolves true when found, false when it gave up or was disposed.
export async function pollUntil(check: () => Promise<boolean>, o: PollUntilOptions): Promise<boolean> {
  const interval = o.intervalMs ?? SENT_POLL_INTERVAL_MS;
  const max = o.maxMs ?? SENT_POLL_MAX_MS;
  const now = o.now ?? Date.now;
  const start = now();
  for (;;) {
    if (await check().catch(() => false)) return true;
    if (now() - start + interval > max) return false;
    if (!(await o.delay(interval))) return false;
  }
}

export const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

// The sent copy of a draft: same id (Outlook keeps it), same
// internetMessageId, or the same subject as a last resort.
export function isSentCopy(m: Message, draftId: string, hint: { subject?: string; internetMessageId?: string } = {}): boolean {
  if (m.isDraft) return false;
  if (m.id === draftId) return true;
  if (hint.internetMessageId && m.internetMessageId === hint.internetMessageId) return true;
  return !!hint.subject && norm(m.subject) === norm(hint.subject);
}

// ---- Visible-tab polling -----------------------------------------------------

export function nextPollDelay(random: () => number = Math.random): number {
  return POLL_INTERVAL_MS + Math.floor(random() * POLL_JITTER_MS);
}

export type PollerOptions = {
  tick: () => Promise<void> | void;
  isVisible: () => boolean;
  random?: () => number;
  now?: () => number;
  initialDelayMs?: number;
};

export type Poller = {
  start: () => void;
  stop: () => void;
  // visibilitychange -> visible, window focus, or the refresh button (force).
  wake: (force?: boolean) => void;
  lastTick: () => number;
};

// Runs `tick` after the initial delay and then every 15 s + jitter while the
// tab is visible. A round that finds the tab hidden stops the timer; wake()
// (on visible) runs at once unless a round ran within WAKE_MIN_GAP_MS, and
// restarts the timer. stop() clears everything.
export function createPoller(o: PollerOptions): Poller {
  const random = o.random ?? Math.random;
  const now = o.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running = false;
  let lastTick = Number.NEGATIVE_INFINITY;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (ms: number) => {
    clear();
    timer = setTimeout(() => void fire(), ms);
  };
  const fire = async () => {
    timer = undefined;
    if (stopped || !o.isVisible()) return; // hidden: paused until wake()
    if (!running) {
      running = true;
      lastTick = now();
      try {
        await o.tick();
      } catch {
        // offline or consent missing: try again next round
      } finally {
        running = false;
      }
    }
    if (!stopped && timer === undefined) schedule(nextPollDelay(random));
  };
  return {
    start() {
      stopped = false;
      schedule(o.initialDelayMs ?? POLL_INITIAL_DELAY_MS);
    },
    stop() {
      stopped = true;
      clear();
    },
    wake(force = false) {
      if (stopped || !o.isVisible()) return;
      if (!force && now() - lastTick < WAKE_MIN_GAP_MS) {
        if (timer === undefined) schedule(nextPollDelay(random));
        return;
      }
      clear();
      void fire();
    },
    lastTick: () => lastTick,
  };
}

// First-page change detection for folders without a delta feed: a row's
// identity plus everything the list renders from it.
export function pageFingerprint(msgs: Message[]): string {
  return msgs.map((m) => `${m.id}|${m.isRead ? 1 : 0}|${m.flag?.flagStatus ?? ""}|${(m.categories ?? []).join(",")}|${m.parentFolderId ?? ""}`).join("\n");
}

// ---- "Updated <n>s ago" --------------------------------------------------------

export function updatedAgoLabel(updatedAt: number, now = Date.now()): string {
  if (!updatedAt) return "";
  const s = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (s < 60) return `Updated ${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `Updated ${m}m ago`;
  return `Updated ${Math.floor(m / 60)}h ago`;
}
