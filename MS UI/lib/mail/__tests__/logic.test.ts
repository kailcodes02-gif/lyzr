import { describe, expect, it } from "vitest";
import { inboxTabPath, labelListPath } from "../labels";
import { buildKql, groupThreads, moveScopeIds, orderFolders, parseKql, participantLabel, folderListPath, searchListPath, SEARCH_ID } from "../logic";
import type { MailFolder, Message } from "../types";

const msg = (p: Partial<Message>): Message => ({ id: p.id ?? Math.random().toString(36), isRead: true, ...p });

describe("orderFolders", () => {
  it("puts well-known folders in Gmail order, then custom folders alphabetically", () => {
    const folders: MailFolder[] = [
      { id: "z", displayName: "Zeta" },
      { id: "d", displayName: "Deleted Items", wellKnownName: "deleteditems" },
      { id: "a", displayName: "Alpha" },
      { id: "s", displayName: "Sent Items", wellKnownName: "sentitems" },
      { id: "i", displayName: "Inbox", wellKnownName: "inbox" },
      { id: "dr", displayName: "Drafts", wellKnownName: "drafts" },
    ];
    expect(orderFolders(folders).map((f) => f.id)).toEqual(["i", "s", "dr", "d", "a", "z"]);
  });
});

describe("groupThreads", () => {
  it("groups by conversationId, sorts messages oldest first and threads newest first", () => {
    const list = [
      msg({ id: "1", conversationId: "A", receivedDateTime: "2026-09-19T10:00:00Z", isRead: true }),
      msg({ id: "2", conversationId: "B", receivedDateTime: "2026-09-20T08:00:00Z", isRead: false, flag: { flagStatus: "flagged" } }),
      msg({ id: "3", conversationId: "A", receivedDateTime: "2026-09-20T09:00:00Z", isRead: true, hasAttachments: true, categories: ["GSI"] }),
      msg({ id: "4", receivedDateTime: "2026-09-01T09:00:00Z" }),
    ];
    const threads = groupThreads(list);
    expect(threads.map((t) => t.conversationId)).toEqual(["A", "B", "4"]);
    const a = threads[0];
    expect(a.messages.map((m) => m.id)).toEqual(["1", "3"]);
    expect(a.latest.id).toBe("3");
    expect(a.unread).toBe(false);
    expect(a.hasAttachments).toBe(true);
    expect(a.categories).toEqual(["GSI"]);
    expect(threads[1].unread).toBe(true);
    expect(threads[1].starred).toBe(true);
  });
  it("drops delta-removed entries", () => {
    expect(groupThreads([msg({ id: "x", conversationId: "C", "@removed": { reason: "deleted" } })])).toEqual([]);
  });
});

describe("participantLabel", () => {
  const from = (name: string, address: string) => ({ emailAddress: { name, address } });
  it("shows first names in order with 'me' for the signed-in user", () => {
    const t = groupThreads([
      msg({ id: "1", conversationId: "A", receivedDateTime: "2026-09-19T10:00:00Z", from: from("Priya Raman", "priya@accenture.com") }),
      msg({ id: "2", conversationId: "A", receivedDateTime: "2026-09-19T11:00:00Z", from: from("Kailash G M", "kailash@lyzr.com") }),
      msg({ id: "3", conversationId: "A", receivedDateTime: "2026-09-19T12:00:00Z", from: from("Priya Raman", "priya@accenture.com") }),
    ])[0];
    expect(participantLabel(t, "kailash@lyzr.com")).toBe("Priya, me");
  });
  it("uses the full sender name for a single-sender thread", () => {
    const t = groupThreads([msg({ id: "1", conversationId: "A", from: from("Daniel Okafor", "d@infosys.com") })])[0];
    expect(participantLabel(t)).toBe("Daniel Okafor");
  });
});

describe("KQL", () => {
  it("builds and strips quotes", () => {
    expect(buildKql({ text: 'weekly "report"', from: "priya", hasAttachment: true, unread: true })).toBe("weekly report from:priya hasAttachments:true isRead:false");
    expect(buildKql({})).toBe("");
  });
  it("round-trips through parseKql", () => {
    expect(parseKql("webinar from:priya subject:accenture isRead:false")).toEqual({ text: "webinar", from: "priya", subject: "accenture", unread: true });
  });
  it("search path has no $orderby and the folder path does", () => {
    expect(searchListPath('from:priya')).not.toContain("$orderby");
    expect(searchListPath('from:priya')).toContain("$search=");
    expect(folderListPath("inbox", "other")).toContain("inferenceClassification eq 'other'");
    expect(folderListPath("starred")).toContain("flag/flagStatus eq 'flagged'");
    expect(folderListPath("f-1")).toContain("$orderby=receivedDateTime desc");
  });
  it("drops quotes from the search string (Graph has no escape for them)", () => {
    expect(decodeURIComponent(searchListPath('say "hello" from:priya'))).toContain('$search="say hello from:priya"');
  });
});

describe("$filter + $orderby invariant (InefficientFilter)", () => {
  const paths = [
    folderListPath("starred"),
    folderListPath("inbox", "focused"),
    folderListPath("sentitems", "other"),
    folderListPath("f-custom"),
    ...(["primary", "social", "promotions"] as const).flatMap((t) => [inboxTabPath(t), inboxTabPath(t, true), inboxTabPath(t, true, "client"), inboxTabPath(t, false, "client")]),
    labelListPath("GSI"),
    labelListPath("Priya's team"),
  ];
  it("puts every $orderby property first in $filter, in order", () => {
    expect(folderListPath("starred")).toMatch(/\$filter=receivedDateTime ge [^&]* and flag\/flagStatus eq 'flagged'&\$orderby=receivedDateTime desc/);
    for (const p of paths) {
      const sp = new URLSearchParams(p.split("?")[1]);
      const filter = sp.get("$filter");
      const orderby = sp.get("$orderby");
      if (!filter || !orderby) continue;
      const props = orderby.split(",").map((s) => s.trim().split(/\s+/)[0]);
      const terms = filter.split(/\s+and\s+/).map((s) => s.trim().split(/\s+/)[0]);
      expect(terms.slice(0, props.length), p).toEqual(props);
    }
  });
});

describe("moveScopeIds", () => {
  const folders: MailFolder[] = [
    { id: "f-inbox", displayName: "Inbox", wellKnownName: "inbox" },
    { id: "f-sent", displayName: "Sent Items", wellKnownName: "sentitems" },
    { id: "f-archive", displayName: "Archive", wellKnownName: "archive" },
    { id: "f-deleted", displayName: "Deleted Items", wellKnownName: "deleteditems" },
  ];
  const thread = [
    msg({ id: "in", parentFolderId: "f-inbox" }),
    msg({ id: "sent", parentFolderId: "f-sent" }),
    msg({ id: "arch", parentFolderId: "f-archive" }),
    msg({ id: "del", parentFolderId: "f-deleted" }),
    msg({ id: "custom", parentFolderId: "f-child" }),
  ];
  it("in a real folder only touches the copies that live there", () => {
    expect(moveScopeIds(thread, "deleteditems", folders)).toEqual(["del"]);
    expect(moveScopeIds(thread, "inbox", folders)).toEqual(["in"]);
    expect(moveScopeIds(thread, "f-child", folders)).toEqual(["custom"]); // child folder id not in the top-level list
  });
  it("in a virtual view skips Sent, Drafts, Trash and Junk copies", () => {
    expect(moveScopeIds(thread, "starred", folders)).toEqual(["in", "arch", "custom"]);
    expect(moveScopeIds(thread, "label:GSI", folders)).toEqual(["in", "arch", "custom"]);
    expect(moveScopeIds(thread, SEARCH_ID, folders)).toEqual(["in", "arch", "custom"]);
  });
  it("is empty until the folder list is known, so actions stay disabled instead of guessing", () => {
    expect(moveScopeIds(thread, "deleteditems", [])).toEqual([]);
    expect(moveScopeIds(thread, "starred", [])).toEqual([]);
  });
});
