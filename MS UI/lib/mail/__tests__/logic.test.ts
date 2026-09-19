import { describe, expect, it } from "vitest";
import { buildKql, groupThreads, orderFolders, parseKql, participantLabel, folderListPath, searchListPath } from "../logic";
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
});
