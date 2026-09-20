import { afterEach, describe, expect, it, vi } from "vitest";
import { ARRIVAL_SUBJECT, handleMail, mockTiming } from "@/lib/mock/mail";
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
    const inbox = call<Page<Message>>("GET", "/me/mailFolders/inbox/messages?$top=50");
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
    const folders = call<Page<{ wellKnownName: string; unreadItemCount: number }>>("GET", "/me/mailFolders");
    expect(folders.value.find((f) => f.wellKnownName === "inbox")!.unreadItemCount).toBeGreaterThan(0);
  });
});
