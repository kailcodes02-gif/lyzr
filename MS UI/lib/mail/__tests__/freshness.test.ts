import type { QueryKey } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPoller, isSentCopy, listKey, nextPollDelay, pageFingerprint, POLL_INITIAL_DELAY_MS, POLL_INTERVAL_MS, POLL_JITTER_MS, pollUntil, refetchTargets, SENT_POLL_MAX_MS, SETTLE_DELAY_MS, Settler, updatedAgoLabel, WAKE_MIN_GAP_MS, type ActionContext, type ActionKind } from "../freshness";
import type { Message } from "../types";

const FOLDERS: QueryKey = ["mail", "folders"];
const THREADS: QueryKey = ["mail", "thread"];

describe("refetchTargets: what each action refetches once Graph has answered", () => {
  const view = { cachedFolders: ["inbox", "starred", "label:GSI", "archive"], activeFolders: ["inbox"] };
  const cases: [string, ActionKind, ActionContext, QueryKey[]][] = [
    ["mark read: source list, counts, thread, message", "read", { sourceFolders: ["inbox"], messageIds: ["m1"], conversationIds: ["c1"] }, [listKey("inbox"), FOLDERS, ["mail", "thread", "c1"], ["mail", "message", "m1"]]],
    ["star: source list and the Starred view", "star", { sourceFolders: ["inbox"], ...view }, [listKey("inbox"), listKey("starred"), FOLDERS, THREADS]],
    ["label: source list and every label view touched", "label", { sourceFolders: ["inbox"], labels: ["GSI", "Urgent"] }, [listKey("inbox"), listKey("label:GSI"), listKey("label:Urgent"), FOLDERS, THREADS]],
    ["archive: Inbox and Archive plus the virtual views that still list it", "archive", { sourceFolders: ["inbox"], ...view }, [listKey("inbox"), listKey("archive"), listKey("starred"), listKey("label:GSI"), FOLDERS, THREADS]],
    ["delete: Inbox and Trash", "trash", { sourceFolders: ["inbox"], messageIds: ["m1"] }, [listKey("inbox"), listKey("deleteditems"), FOLDERS, THREADS, ["mail", "message", "m1"]]],
    ["report spam: Inbox and Junk", "spam", { sourceFolders: ["inbox"] }, [listKey("inbox"), listKey("junkemail"), FOLDERS, THREADS]],
    ["not spam: Junk and Inbox", "inbox", { sourceFolders: ["junkemail"] }, [listKey("junkemail"), listKey("inbox"), FOLDERS, THREADS]],
    ["move to a custom folder", "move", { sourceFolders: ["inbox"], destination: "f-reports" }, [listKey("inbox"), listKey("f-reports"), FOLDERS, THREADS]],
    ["delete forever from Trash, with a cached Starred view", "deleteForever", { sourceFolders: ["deleteditems"], cachedFolders: ["starred", "inbox"] }, [listKey("deleteditems"), listKey("starred"), FOLDERS, THREADS]],
    ["send: Drafts and Sent Items", "send", { conversationIds: ["c9"] }, [listKey("sentitems"), listKey("drafts"), FOLDERS, ["mail", "thread", "c9"]]],
    ["save / discard draft, reply, forward: Drafts", "draft", {}, [listKey("drafts"), FOLDERS, THREADS]],
    ["undo send keeps the draft", "undoSend", {}, [listKey("drafts"), FOLDERS, THREADS]],
    ["folder create/rename/delete: folder lists, the folder and Trash", "folder", { sourceFolders: ["f-x"] }, [["mail", "childFolders"], listKey("f-x"), listKey("deleteditems"), FOLDERS]],
    ["label create/edit/delete: categories, rules, its view", "category", { labels: ["GSI"] }, [["mail", "categories"], ["mail", "rules"], listKey("label:GSI"), FOLDERS]],
    ["rules: the rule list and the Inbox they act on", "rules", {}, [["mail", "rules"], listKey("inbox"), FOLDERS]],
    ["presets: everything", "presets", {}, [["mail"]]],
  ];
  it.each(cases)("%s", (_name, kind, ctx, expected) => {
    expect(refetchTargets(kind, ctx)).toEqual(expected);
  });
  it("never lists a key twice and always includes the mounted view", () => {
    const keys = refetchTargets("trash", { sourceFolders: ["inbox"], activeFolders: ["inbox", "label:GSI"], cachedFolders: ["inbox"] });
    expect(new Set(keys.map((k) => JSON.stringify(k))).size).toBe(keys.length);
    expect(keys).toContainEqual(listKey("label:GSI"));
  });
});

describe("Settler: refetch when the call settles and again 2.5 s later", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("runs the targets at once, verifies, then repeats them at SETTLE_DELAY_MS", async () => {
    const invalidate = vi.fn(async () => {});
    const verify = vi.fn();
    const s = new Settler(invalidate);
    await s.settle([["a"], ["b"]], verify);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenCalledWith("settled");
    await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS - 1);
    expect(invalidate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(invalidate).toHaveBeenCalledTimes(4);
    expect(invalidate.mock.calls.map((c) => (c as unknown[])[0])).toEqual([["a"], ["b"], ["a"], ["b"]]);
    expect(verify).toHaveBeenLastCalledWith("late");
  });
  it("a failed refetch does not stop the others, and dispose cancels the late round", async () => {
    const invalidate = vi.fn(async (k: QueryKey) => {
      if (k[0] === "bad") throw new Error("offline");
    });
    const s = new Settler(invalidate);
    await s.settle([["bad"], ["ok"]]);
    expect(invalidate).toHaveBeenCalledTimes(2);
    s.dispose();
    await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS * 2);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(await s.delay(10)).toBe(false);
  });
});

describe("pollUntil: the Sent Items poll", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("checks every 2 s and stops as soon as the sent copy shows", async () => {
    const s = new Settler(async () => {});
    let n = 0;
    const check = vi.fn(async () => ++n >= 3);
    const p = pollUntil(check, { delay: (ms) => s.delay(ms) });
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(check).toHaveBeenCalledTimes(3);
    await expect(p).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(check).toHaveBeenCalledTimes(3);
  });
  it("gives up after 20 s (11 checks) and treats a failing check as not found", async () => {
    const s = new Settler(async () => {});
    const never = vi.fn(async () => {
      throw new Error("throttled");
    });
    const p = pollUntil(never, { delay: (ms) => s.delay(ms) });
    await vi.advanceTimersByTimeAsync(SENT_POLL_MAX_MS + 5000);
    await expect(p).resolves.toBe(false);
    expect(never).toHaveBeenCalledTimes(11);
  });
  it("stops when the screen is disposed", async () => {
    const s = new Settler(async () => {});
    const check = vi.fn(async () => false);
    const p = pollUntil(check, { delay: (ms) => s.delay(ms) });
    await vi.advanceTimersByTimeAsync(0);
    s.dispose();
    await expect(p).resolves.toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe("createPoller: the open view is polled only while the tab is visible", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("waits the initial delay, then every 15 s + jitter; hidden pauses; visible and focus wake it", async () => {
    let visible = true;
    const tick = vi.fn(async () => {});
    const poller = createPoller({ tick, isVisible: () => visible, random: () => 0 });
    poller.start();
    await vi.advanceTimersByTimeAsync(POLL_INITIAL_DELAY_MS - 1);
    expect(tick).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
    // Hidden: the next round is skipped and no timer keeps running.
    visible = false;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    expect(tick).toHaveBeenCalledTimes(2);
    // Back to visible: at once, then the cadence restarts.
    visible = true;
    poller.wake();
    expect(tick).toHaveBeenCalledTimes(3);
    poller.wake(); // a focus right after the visibility change is the same event
    expect(tick).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(WAKE_MIN_GAP_MS);
    poller.wake();
    expect(tick).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(5);
    poller.stop();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(tick).toHaveBeenCalledTimes(5);
  });
  it("wake while hidden does nothing, and the refresh button forces a round", async () => {
    let visible = false;
    const tick = vi.fn(async () => {});
    const poller = createPoller({ tick, isVisible: () => visible, random: () => 0 });
    poller.start();
    poller.wake();
    expect(tick).toHaveBeenCalledTimes(0);
    visible = true;
    poller.wake(true);
    poller.wake(true); // a round is in flight: not started twice
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    poller.wake(true);
    expect(tick).toHaveBeenCalledTimes(2);
  });
  it("jitter keeps every interval within [15 s, 17 s), never faster than 15 s", () => {
    expect(nextPollDelay(() => 0)).toBe(POLL_INTERVAL_MS);
    expect(nextPollDelay(() => 0.999999)).toBeLessThan(POLL_INTERVAL_MS + POLL_JITTER_MS);
    for (let i = 0; i < 200; i++) {
      const d = nextPollDelay();
      expect(d).toBeGreaterThanOrEqual(POLL_INTERVAL_MS);
      expect(d).toBeLessThan(POLL_INTERVAL_MS + POLL_JITTER_MS);
    }
    expect(POLL_INTERVAL_MS).toBeGreaterThanOrEqual(15_000);
  });
});

describe("helpers", () => {
  const m = (over: Partial<Message>): Message => ({ id: "x", subject: "Hello", isDraft: false, ...over });
  it("isSentCopy matches by id, internetMessageId or subject, never a draft", () => {
    expect(isSentCopy(m({ id: "d1" }), "d1")).toBe(true);
    expect(isSentCopy(m({ id: "s1", internetMessageId: "<a@b>" }), "d1", { internetMessageId: "<a@b>" })).toBe(true);
    expect(isSentCopy(m({ id: "s1", subject: "  hello " }), "d1", { subject: "Hello" })).toBe(true);
    expect(isSentCopy(m({ id: "s1", subject: "Other" }), "d1", { subject: "Hello" })).toBe(false);
    expect(isSentCopy(m({ id: "d1", isDraft: true }), "d1")).toBe(false);
    expect(isSentCopy(m({ id: "s1" }), "d1")).toBe(false);
  });
  it("pageFingerprint changes with anything the row renders", () => {
    const a = [m({ id: "1", isRead: false }), m({ id: "2" })];
    expect(pageFingerprint(a)).toBe(pageFingerprint([...a]));
    expect(pageFingerprint(a)).not.toBe(pageFingerprint([m({ id: "1", isRead: true }), m({ id: "2" })]));
    expect(pageFingerprint(a)).not.toBe(pageFingerprint([m({ id: "1", isRead: false, flag: { flagStatus: "flagged" } }), m({ id: "2" })]));
    expect(pageFingerprint(a)).not.toBe(pageFingerprint([a[1], a[0]]));
  });
  it("updatedAgoLabel", () => {
    const now = Date.UTC(2026, 8, 20, 9, 0, 0);
    expect(updatedAgoLabel(0, now)).toBe("");
    expect(updatedAgoLabel(now, now)).toBe("Updated 0s ago");
    expect(updatedAgoLabel(now - 12_000, now)).toBe("Updated 12s ago");
    expect(updatedAgoLabel(now - 90_000, now)).toBe("Updated 1m ago");
    expect(updatedAgoLabel(now - 2 * 3600_000, now)).toBe("Updated 2h ago");
  });
});
