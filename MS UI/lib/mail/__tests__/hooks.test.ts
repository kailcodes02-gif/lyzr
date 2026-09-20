import { describe, expect, it, vi } from "vitest";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [] }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { ConsentRequiredError, GraphError, type BatchRequest, type BatchResponse } from "@/lib/graph";
import { handleMail, mockFolders } from "@/lib/mock/mail";
import { ATTACHMENT_CAST_PATH, deltaSeedPath, fetchAttachments, isConsentError, isDeadDeltaLink, labelFolderId, labelMessagesClientSide, partitionBatch, runBatch } from "../hooks";
import { backfillLabel, ensureFolder } from "../install";
import { EMPTY_CONDITIONS } from "../labels";
import type { Attachment, MessageRule } from "../types";
import { mockApi, type Message, type Page } from "./helpers";

describe("isConsentError", () => {
  it("recognises ConsentRequiredError from getToken, Graph 401/403, and nothing else", () => {
    expect(isConsentError(new ConsentRequiredError(["Mail.ReadWrite"], "consent_required"))).toBe(true);
    expect(isConsentError(new GraphError(403, "ErrorAccessDenied", "denied", "/me/messages"))).toBe(true);
    expect(isConsentError(new GraphError(401, "InvalidAuthenticationToken", "x", "/me"))).toBe(true);
    expect(isConsentError(new GraphError(400, "InefficientFilter", "x", "/me/messages"))).toBe(false);
    expect(isConsentError(new Error("offline"))).toBe(false);
    const duplicated = Object.assign(new Error("Admin approval needed"), { name: "ConsentRequiredError" });
    expect(isConsentError(duplicated)).toBe(true);
  });
});

describe("batch results", () => {
  const reqs: BatchRequest[] = ["a", "b", "c"].map((id) => ({ id, method: "PATCH", url: `/me/messages/${id}`, body: { isRead: true } }));
  it("correlates by response id, not by position", () => {
    const res: BatchResponse[] = [
      { id: "c", status: 200 },
      { id: "a", status: 404, body: { error: { code: "ErrorItemNotFound", message: "gone" } } },
      { id: "b", status: 204 },
    ];
    const out = partitionBatch(reqs, res);
    expect(out.ok).toEqual(["b", "c"]);
    expect(out.failed).toEqual([{ id: "a", status: 404, detail: "ErrorItemNotFound: gone" }]);
  });
  it("retries only throttled sub-requests after Retry-After and reports the rest as failed", async () => {
    const calls: string[][] = [];
    const send = vi.fn(async (r: BatchRequest[]): Promise<BatchResponse[]> => {
      calls.push(r.map((x) => x.id));
      if (calls.length === 1) return [{ id: "a", status: 200 }, { id: "b", status: 429, headers: { "Retry-After": "3" } }, { id: "c", status: 500 }];
      return [{ id: "b", status: 200 }];
    });
    const sleep = vi.fn(async () => {});
    const out = await runBatch(send, reqs, sleep);
    expect(calls).toEqual([["a", "b", "c"], ["b"]]);
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(out.ok).toEqual(["a", "b"]);
    expect(out.failed.map((f) => f.id)).toEqual(["c"]);
  });
  it("marks everything still pending as failed when the batch call itself throws", async () => {
    const out = await runBatch(async () => { throw new Error("offline"); }, reqs);
    expect(out.ok).toEqual([]);
    expect(out.failed.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(out.failed[0].detail).toBe("offline");
  });
});

describe("fetchAttachments", () => {
  const base: Attachment[] = [
    { id: "1", name: "deck.pdf", contentType: "application/pdf", size: 10, isInline: false },
    { id: "2", name: "logo.png", contentType: "image/png", size: 5, isInline: true },
  ];
  type FetchJson = <T>(path: string) => Promise<T>;
  it("never puts contentId in the collection $select and takes it from the fileAttachment cast", async () => {
    const seen: string[] = [];
    const fetchJson: FetchJson = async <T,>(path: string): Promise<T> => {
      seen.push(path);
      if (path === ATTACHMENT_CAST_PATH("m1")) return { value: [{ id: "2", contentId: "<logo@1>" }] } as T;
      return { value: base } as T;
    };
    const out = await fetchAttachments(fetchJson, "m1");
    expect(seen[0]).toContain("$select=id,name,contentType,size,isInline");
    expect(seen[0]).not.toContain("contentId");
    expect(out.find((a) => a.id === "2")?.contentId).toBe("<logo@1>");
    expect(out.find((a) => a.id === "1")?.contentId).toBeUndefined();
  });
  it("falls back to reading each inline attachment when the cast is refused, and skips the cast with no inline ones", async () => {
    const fetchJson: FetchJson = async <T,>(path: string): Promise<T> => {
      if (path.includes("microsoft.graph.fileAttachment")) throw new GraphError(400, "BadRequest", "no cast", path);
      if (path.endsWith("/attachments/2")) return { ...base[1], contentId: "logo@2", contentBytes: "AAAA" } as T;
      return { value: base } as T;
    };
    const out = await fetchAttachments(fetchJson, "m1");
    expect(out.find((a) => a.id === "2")?.contentId).toBe("logo@2");
    let calls = 0;
    const onlyFiles: FetchJson = async <T,>(): Promise<T> => {
      calls++;
      return { value: [base[0]] } as T;
    };
    await fetchAttachments(onlyFiles, "m2");
    expect(calls).toBe(1);
  });
});

describe("delta sync", () => {
  it("seeds with the only $filter delta accepts and treats a dead token as a reset", () => {
    const now = Date.UTC(2026, 8, 20, 9, 0, 0);
    expect(deltaSeedPath(now)).toBe("/me/mailFolders/inbox/messages/delta?$select=id,isRead,receivedDateTime&$filter=receivedDateTime ge 2026-09-20T08:00:00.000Z");
    expect(isDeadDeltaLink(new GraphError(410, "SyncStateNotFound", "x", "/delta"))).toBe(true);
    expect(isDeadDeltaLink(new GraphError(400, "ErrorInvalidSyncStateData", "x", "/delta"))).toBe(true);
    expect(isDeadDeltaLink(new GraphError(429, "Throttled", "x", "/delta"))).toBe(false);
    expect(isDeadDeltaLink(new Error("offline"))).toBe(false);
  });
});

describe("client-side label fallback", () => {
  const call = <T,>(path: string) => handleMail("GET", new URL(`https://graph.microsoft.com/v1.0${path}`), undefined) as T;
  const get = async <T,>(path: string) => call<T>(path);
  const getAll = async (path: string) => call<Page<Message>>(path).value;
  it("includes the label's own folder (from the cached rules, else by name) so skip-inbox mail is not hidden", async () => {
    const api = mockApi();
    const folder = await ensureFolder(api, "Wipro");
    const res = await backfillLabel(api, "Wipro", { ...EMPTY_CONDITIONS, from: ["@wipro.com"] }, undefined, folder.id);
    expect(res.moved).toBeGreaterThan(0);
    // Inbox + Archive alone miss every moved message.
    const without = await labelMessagesClientSide(getAll, "Wipro", undefined);
    expect(without.filter((m) => m.parentFolderId === folder.id)).toHaveLength(0);
    const rules: MessageRule[] = [{ id: "r", displayName: "Label: Wipro (sender keywords)", sequence: 1, isEnabled: true, conditions: { senderContains: ["@wipro.com"] }, actions: { assignCategories: ["Wipro"], moveToFolder: folder.id, stopProcessingRules: true } }];
    expect(await labelFolderId(get, "Wipro", rules)).toBe(folder.id);
    expect(await labelFolderId(get, "wipro")).toBe(folder.id); // no rules cached: by name
    expect(await labelFolderId(get, "No such label")).toBeUndefined();
    const withFolder = await labelMessagesClientSide(getAll, "wipro", folder.id);
    expect(withFolder.length).toBe(res.moved);
    expect(withFolder.every((m) => m.categories?.includes("Wipro"))).toBe(true);
    const dates = withFolder.map((m) => m.receivedDateTime ?? "");
    expect(dates).toEqual([...dates].sort().reverse());
    // The inbox and archive are still scanned for labelled mail that never moved.
    expect((await labelMessagesClientSide(getAll, "GSI", undefined)).some((m) => m.parentFolderId === "f-inbox")).toBe(true);
    // A folder that cannot be read is skipped, never fatal.
    expect((await labelMessagesClientSide(getAll, "Wipro", "f-does-not-exist")).length).toBe(0);
  });
  it("resolves a reserved label name to its safe folder", async () => {
    const api = mockApi();
    const tasks = await ensureFolder(api, "Tasks");
    expect(tasks.displayName).toBe("Tasks mail");
    expect(await labelFolderId(get, "Tasks")).toBe(tasks.id);
    expect(mockFolders.some((f) => f.displayName === "Tasks")).toBe(false);
  });
});
