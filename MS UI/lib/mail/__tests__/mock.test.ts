import { describe, expect, it } from "vitest";
import { handleMail } from "@/lib/mock/mail";
import type { Message, Page } from "./helpers";

const call = <T,>(method: string, path: string, body?: unknown) => handleMail(method, new URL(`https://graph.microsoft.com/v1.0${path}`), body) as T;

describe("mock mail handler", () => {
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
    call("POST", `/me/messages/${id}/move`, { destinationId: "archive" });
    const archive = call<Page<Message>>("GET", "/me/mailFolders/archive/messages?$top=50");
    expect(archive.value.some((m) => m.id === id)).toBe(true);
    const draft = call<Message>("POST", `/me/messages/${id}/createReplyAll`, {});
    expect(draft.isDraft).toBe(true);
    expect(draft.subject?.startsWith("RE:")).toBe(true);
    expect(draft.body?.content).toContain("divRplyFwdMsg");
    call("POST", `/me/messages/${draft.id}/send`);
    const sent = call<Page<Message>>("GET", "/me/mailFolders/sentitems/messages?$top=50");
    expect(sent.value.some((m) => m.id === draft.id)).toBe(true);
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
});
