import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphError } from "@/lib/graph";
import { mockGraph } from "@/lib/mock";
import { ARRIVAL_SUBJECT, handleMail, mockRules, mockSentMail, mockTiming, REST_ID_PREFIX } from "@/lib/mock/mail";
import type { Message, Page } from "./helpers";

const call = <T,>(method: string, path: string, body?: unknown) => handleMail(method, new URL(`https://graph.microsoft.com/v1.0${path}`), body) as T;

describe("mock mail handler", () => {
  afterEach(() => vi.useRealTimers());
  it("lists inbox messages newest first with paging and focused/other filtering", () => {
    const p1 = call<Page<Message>>("GET", "/me/mailFolders/inbox/messages?$top=10");
    expect(p1.value).toHaveLength(10);
    expect(p1["@odata.nextLink"]).toMatch(/(%24|\$)skip=10/);
    const dates = p1.value.map((m) => m.receivedDateTime!);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(p1.value[0].body).toBeUndefined();
    const other = call<Page<Message>>("GET", "/me/mailFolders/inbox/messages?$top=50&$filter=inferenceClassification eq 'other'");
    expect(other.value.length).toBeGreaterThan(0);
    expect(other.value.every((m) => m.inferenceClassification === "other")).toBe(true);
  });
  it("searches with KQL and returns single messages with a body", () => {
    const res = call<Page<Message>>("GET", '/me/messages?$search="from:accenture"&$top=50');
    expect(res.value.length).toBeGreaterThan(0);
    expect(res.value.every((m) => m.from?.emailAddress?.address?.includes("accenture"))).toBe(true);
    const full = call<Message>("GET", `/me/messages/${res.value[0].id}`);
    expect(full.body?.content).toContain("<");
  });
  it("search results carry REST ids (no immutable Prefer on $search) that differ from list ids, and every message URL accepts either format", () => {
    const res = call<Page<Message>>("GET", '/me/messages?$search="from:accenture"&$top=50');
    expect(res.value.every((m) => m.id.startsWith(REST_ID_PREFIX))).toBe(true);
    const restId = res.value[0].id;
    const immutableId = restId.slice(REST_ID_PREFIX.length);
    const inbox = call<Page<Message>>("GET", "/me/mailFolders/inbox/messages?$top=500");
    expect(inbox.value.some((m) => m.id === restId)).toBe(false);
    expect(inbox.value.some((m) => m.id === immutableId)).toBe(true);
    // Same conversationId in both formats (the Prefer only changes item ids).
    expect(res.value[0].conversationId).toBe(inbox.value.find((m) => m.id === immutableId)!.conversationId);
    // Star, label and move through the REST id.
    call("PATCH", `/me/messages/${restId}`, { flag: { flagStatus: "flagged" }, categories: ["Urgent"] });
    const full = call<Message>("GET", `/me/messages/${immutableId}`);
    expect(full.flag?.flagStatus).toBe("flagged");
    expect(full.categories).toContain("Urgent");
    const moved = call<Message>("POST", `/me/messages/${restId}/move`, { destinationId: "archive" });
    expect(moved.parentFolderId).toBe("f-archive");
    expect(call<{ error?: { code: string } }>("GET", `/me/messages/${restId}`).error?.code).toBe("ErrorItemNotFound");
    call("DELETE", `/me/messages/${REST_ID_PREFIX}${moved.id}`);
    expect(call<{ error?: { code: string } }>("GET", `/me/messages/${moved.id}`).error?.code).toBe("ErrorItemNotFound");
  });
  it("$batch rejects a repeated request id for the whole batch, exactly like Graph", async () => {
    const dup = { id: "AAMk-1", method: "PATCH", url: "/me/messages/x", body: { isRead: true } };
    await expect(mockGraph("/$batch", "POST", { requests: [dup, { ...dup }] })).rejects.toMatchObject({ status: 400, code: "BadRequest", message: "Request Id AAMk-1 has to be unique in a batch" });
    await expect(mockGraph("/$batch", "POST", { requests: [dup, { ...dup, id: "aamk-1" }] })).rejects.toBeInstanceOf(GraphError);
    await expect(mockGraph("/$batch", "POST", { requests: Array.from({ length: 21 }, (_, i) => ({ ...dup, id: String(i) })) })).rejects.toMatchObject({ status: 400 });
    const ok = (await mockGraph("/$batch", "POST", { requests: [{ id: "1", method: "GET", url: "/me/mailFolders/inbox" }, { id: "2", method: "GET", url: "/me/mailFolders/archive" }] })) as { responses: { id: string; status: number }[] };
    expect(ok.responses.map((r) => [r.id, r.status])).toEqual([["1", 200], ["2", 200]]);
  });
  it("patches, moves and replies keeping state", () => {
    const inbox = call<Page<Message>>("GET", "/me/mailFolders/inbox/messages?$top=1");
    const id = inbox.value[0].id;
    call("PATCH", `/me/messages/${id}`, { flag: { flagStatus: "flagged" }, isRead: false });
    const starred = call<Page<Message>>("GET", "/me/messages?$filter=flag/flagStatus eq 'flagged'&$top=50");
    expect(starred.value.some((m) => m.id === id)).toBe(true);
    // Like Graph, a move creates a copy (new id) and removes the original.
    const moved = call<Message>("POST", `/me/messages/${id}/move`, { destinationId: "archive" });
    expect(moved.id).not.toBe(id);
    expect(moved.conversationId).toBe(inbox.value[0].conversationId);
    const archive = call<Page<Message>>("GET", "/me/mailFolders/archive/messages?$top=50");
    expect(archive.value.some((m) => m.id === moved.id)).toBe(true);
    expect(archive.value.some((m) => m.id === id)).toBe(false);
    expect(call<{ error?: { code: string } }>("GET", `/me/messages/${id}`).error?.code).toBe("ErrorItemNotFound");
    expect(call<Page<Message>>("GET", "/me/mailFolders/inbox/messages?$top=50").value.some((m) => m.id === id)).toBe(false);
    const draft = call<Message>("POST", `/me/messages/${moved.id}/createReplyAll`, {});
    expect(draft.isDraft).toBe(true);
    expect(draft.subject?.startsWith("RE:")).toBe(true);
    expect(draft.body?.content).toContain("divRplyFwdMsg");
    // Sent mail sits in the Outbox first, like Outlook; Sent Items lists it after the delay.
    vi.useFakeTimers();
    call("POST", `/me/messages/${draft.id}/send`);
    const drafts = call<Page<Message>>("GET", "/me/mailFolders/drafts/messages?$top=50");
    expect(drafts.value.some((m) => m.id === draft.id)).toBe(false);
    expect(call<Page<Message>>("GET", "/me/mailFolders/sentitems/messages?$top=50").value.some((m) => m.id === draft.id)).toBe(false);
    vi.setSystemTime(Date.now() + mockTiming.sendDelayMs);
    const sent = call<Page<Message>>("GET", "/me/mailFolders/sentitems/messages?$top=50");
    expect(sent.value.some((m) => m.id === draft.id && !m.isDraft)).toBe(true);
  });
  it("delta walks the folder without a token and returns only changes since the token", () => {
    vi.useFakeTimers();
    const seed = call<Page<Message> & { "@odata.deltaLink": string }>("GET", "/me/mailFolders/inbox/messages/delta");
    expect(seed.value.length).toBeGreaterThan(10);
    const link = new URL(seed["@odata.deltaLink"]);
    const token = link.searchParams.get("$deltatoken")!;
    expect(Number(token)).toBe(Date.now());
    vi.setSystemTime(Date.now() + 1000);
    const quiet = call<Page<Message>>("GET", `/me/mailFolders/inbox/messages/delta?$deltatoken=${token}`);
    expect(quiet.value).toEqual([]);
    const id = seed.value[3].id;
    call("PATCH", `/me/messages/${id}`, { isRead: true });
    const changed = call<Page<Message>>("GET", `/me/mailFolders/inbox/messages/delta?$deltatoken=${token}`);
    expect(changed.value.map((m) => m.id)).toEqual([id]);
  });
  it("enforces the $filter/$orderby rule like Graph (InefficientFilter) so a bad query fails in the demo too", () => {
    expect(() => call("GET", "/me/messages?$filter=flag/flagStatus eq 'flagged'&$orderby=receivedDateTime desc&$top=50")).toThrow(/InefficientFilter|too complex/);
    expect(() => call("GET", "/me/mailFolders/inbox/messages?$filter=inferenceClassification eq 'focused'&$orderby=receivedDateTime desc")).toThrow(/too complex/);
    const ok = call<Page<Message>>("GET", "/me/messages?$filter=receivedDateTime ge 1970-01-01T00:00:00Z and flag/flagStatus eq 'flagged'&$orderby=receivedDateTime desc&$top=50");
    expect(ok.value.length).toBeGreaterThan(0);
  });
  it("rejects contentId in the attachments $select and serves it through the fileAttachment cast", () => {
    const inbox = call<Page<Message>>("GET", "/me/mailFolders/inbox/messages?$top=500");
    const withInline = inbox.value.find((m) => /Wipro ai360/.test(m.subject ?? ""))!;
    expect(() => call("GET", `/me/messages/${withInline.id}/attachments?$select=id,name,contentType,size,isInline,contentId`)).toThrow(/contentId/);
    const base = call<Page<{ id: string; contentId?: string }>>("GET", `/me/messages/${withInline.id}/attachments?$select=id,name,contentType,size,isInline`);
    expect(base.value.length).toBe(1);
    expect(base.value[0].contentId).toBeUndefined();
    const cast = call<Page<{ id: string; contentId?: string | null }>>("GET", `/me/messages/${withInline.id}/attachments/microsoft.graph.fileAttachment?$select=id,contentId`);
    expect(cast.value[0].contentId).toBe("checklist-img");
  });
  it("creates folders and categories and applies a new inbox rule", () => {
    const f = call<{ id: string }>("POST", "/me/mailFolders", { displayName: "Wipro" });
    expect(call<Page<{ id: string }>>("GET", "/me/mailFolders").value.some((x) => x.id === f.id)).toBe(true);
    const c = call<{ id: string; color: string }>("POST", "/me/outlook/masterCategories", { displayName: "Partners", color: "preset3" });
    expect(c.color).toBe("preset3");
    call("DELETE", `/me/outlook/masterCategories/${c.id}`);
    expect(call<Page<{ id: string }>>("GET", "/me/outlook/masterCategories").value.some((x) => x.id === c.id)).toBe(false);
    call("POST", "/me/mailFolders/inbox/messageRules", { displayName: "Wipro", conditions: { senderContains: ["wipro.com"] }, actions: { moveToFolder: f.id } });
    const moved = call<Page<Message>>("GET", `/me/mailFolders/${f.id}/messages?$top=50`);
    expect(moved.value.length).toBeGreaterThan(0);
    expect(moved.value.every((m) => m.from?.emailAddress?.address?.endsWith("wipro.com"))).toBe(true);
  });
  it("a message arrives in the inbox on its own after the arrival delay and the delta reports it", () => {
    vi.useFakeTimers();
    const seed = call<Page<Message> & { "@odata.deltaLink": string }>("GET", "/me/mailFolders/inbox/messages/delta");
    const token = new URL(seed["@odata.deltaLink"]).searchParams.get("$deltatoken")!;
    expect(seed.value.some((m) => m.subject === ARRIVAL_SUBJECT)).toBe(false);
    vi.setSystemTime(Date.now() + mockTiming.arrivalDelayMs + 1000);
    const changed = call<Page<Message>>("GET", `/me/mailFolders/inbox/messages/delta?$deltatoken=${token}`);
    expect(changed.value.map((m) => m.subject)).toContain(ARRIVAL_SUBJECT);
    const inbox = call<Page<Message>>("GET", "/me/mailFolders/inbox/messages?$top=5");
    expect(inbox.value[0].subject).toBe(ARRIVAL_SUBJECT);
    expect(inbox.value[0].isRead).toBe(false);
    const folders = call<Page<{ id: string; unreadItemCount: number }>>("GET", "/me/mailFolders");
    const inboxId = call<{ id: string }>("GET", "/me/mailFolders/inbox").id;
    expect(folders.value.find((f) => f.id === inboxId)!.unreadItemCount).toBeGreaterThan(0);
  });
});

describe("mock rules: Outlook vocabulary on arrival", () => {
  const post = (rule: unknown) => call<{ id: string }>("POST", "/me/mailFolders/inbox/messageRules", rule);
  const inbox = () => call<Page<Message>>("GET", "/me/mailFolders/inbox/messages?$top=100").value;
  const cleanup = (id: string) => call("DELETE", `/me/mailFolders/inbox/messageRules/${id}`);
  it("applies bodyContains, recipientContains, sentToAddresses, hasAttachments, importance and size ranges; any one exception blocks", () => {
    const before = inbox();
    const withAtt = before.filter((m) => m.hasAttachments);
    expect(withAtt.length).toBeGreaterThan(0);
    // Not an app rule ("Label: "), so the demo applies it to the inbox at once.
    const r1 = post({ displayName: "Attachments from partners", sequence: 50, isEnabled: true, conditions: { hasAttachments: true, recipientContains: ["kailash"] }, exceptions: { importance: "high", subjectContains: ["nothing matches this"] }, actions: { assignCategories: ["Urgent"] } });
    const after = inbox();
    const tagged = after.filter((m) => m.categories?.includes("Urgent") && m.hasAttachments);
    expect(tagged.length).toBeGreaterThan(0);
    // The high-importance exception alone (one of two) blocked those.
    expect(after.filter((m) => m.hasAttachments && m.importance === "high").every((m) => !m.categories?.includes("Urgent") || before.find((b) => b.id === m.id)?.categories?.includes("Urgent"))).toBe(true);
    cleanup(r1.id);
    // (The Wipro mail was filed by an earlier test; the TCS redline mail is still in the inbox.)
    expect(inbox().some((m) => /TCS co-sell deck: legal review complete/.test(m.subject ?? ""))).toBe(true);
    const r2 = post({ displayName: "Small redlines to me", sequence: 51, isEnabled: true, conditions: { withinSizeRange: { minimumSize: 1, maximumSize: 100 }, sentToAddresses: [{ emailAddress: { address: "kailash.gm@lyzr.com" } }], bodyContains: ["redline"] }, actions: { moveToFolder: "f-archive" } });
    expect(inbox().some((m) => /TCS co-sell deck: legal review complete/.test(m.subject ?? ""))).toBe(false);
    expect(call<Page<Message>>("GET", "/me/mailFolders/archive/messages?$top=50").value.some((m) => /TCS co-sell deck/.test(m.subject ?? ""))).toBe(true);
    // Out of range: nothing else moves.
    const r3 = post({ displayName: "Huge", sequence: 52, isEnabled: true, conditions: { withinSizeRange: { minimumSize: 50_000 } }, actions: { moveToFolder: "f-archive" } });
    expect(inbox().length).toBeGreaterThan(20);
    cleanup(r3.id);
    cleanup(r2.id);
    expect(mockRules.some((r) => r.id === r1.id || r.id === r2.id)).toBe(false);
  });
  it("ships a GSI folder with mail both with and without the category", () => {
    const gsi = call<Page<Message>>("GET", "/me/mailFolders/f-gsi/messages?$top=50").value;
    expect(gsi).toHaveLength(3);
    expect(gsi.filter((m) => m.categories?.includes("GSI"))).toHaveLength(1);
    expect(call<Page<{ displayName: string }>>("GET", "/me/mailFolders?$select=id,displayName").value.some((f) => f.displayName === "GSI")).toBe(true);
  });
});

describe("mock unsubscribe surface", () => {
  it("answers $select=internetMessageHeaders with the headers only, and the newsletters carry the three variants", () => {
    const inbox = call<Page<Message>>("GET", "/me/mailFolders/inbox/messages?$top=500");
    const hubspot = inbox.value.find((m) => m.subject?.startsWith("Your weekly HubSpot digest"))!;
    const pulse = inbox.value.find((m) => m.subject?.startsWith("LinkedIn Pulse"))!;
    const ph = inbox.value.find((m) => m.subject?.startsWith("Product Hunt Daily"))!;
    const h = call<Message>("GET", `/me/messages/${hubspot.id}?$select=internetMessageHeaders`);
    expect(Object.keys(h).sort()).toEqual(["id", "internetMessageHeaders"]);
    expect(h.internetMessageHeaders?.map((x) => x.name)).toEqual(["List-Unsubscribe", "List-Unsubscribe-Post"]);
    expect(call<Message>("GET", `/me/messages/${pulse.id}?$select=internetMessageHeaders`).internetMessageHeaders?.[0].value).toMatch(/^<mailto:/);
    expect(call<Message>("GET", `/me/messages/${ph.id}?$select=internetMessageHeaders`).internetMessageHeaders).toEqual([]);
    expect(call<Message>("GET", `/me/messages/${ph.id}`).body?.content).toMatch(/<a href="https:\/\/producthunt\.example\/opt-out[^"]*">Unsubscribe<\/a>/);
  });
  it("a conversation query lists Junk and Trash copies (Graph does), the plain list does not", () => {
    const junk = call<Page<Message>>("GET", "/me/mailFolders/junkemail/messages?$top=5").value[0];
    const thread = call<Page<Message>>("GET", `/me/messages?$filter=conversationId eq '${junk.conversationId}'&$top=100`);
    expect(thread.value.map((m) => m.id)).toContain(junk.id);
    const plain = call<Page<Message>>("GET", "/me/messages?$top=500");
    expect(plain.value.some((m) => m.parentFolderId === "f-junk")).toBe(false);
  });
  it("POST /me/sendMail files a copy in Sent Items and logs it", () => {
    const before = mockSentMail.length;
    const res = call<unknown>("POST", "/me/sendMail", { message: { subject: "Unsubscribe", body: { contentType: "text", content: "bye" }, toRecipients: [{ emailAddress: { address: "unsub@example.com" } }] }, saveToSentItems: true });
    expect(res).toBeNull();
    expect(mockSentMail).toHaveLength(before + 1);
    expect(mockSentMail[before].toRecipients?.[0].emailAddress.address).toBe("unsub@example.com");
    const sent = call<Page<Message>>("GET", "/me/mailFolders/sentitems/messages?$top=5");
    expect(sent.value.some((m) => m.subject === "Unsubscribe" && m.toRecipients?.[0].emailAddress.address === "unsub@example.com")).toBe(true);
    expect(() => call("POST", "/me/sendMail", { message: { subject: "x" } })).toThrow(GraphError);
  });
});
