import { describe, expect, it } from "vitest";
import { GraphError, type BatchRequest, type BatchResponse } from "@/lib/graph";
import { handleMail, mockFolders } from "@/lib/mock/mail";
import { FOLDER_SELECT, guessWellKnownByName, WELL_KNOWN_ALIASES, wellKnownIdsFrom, wellKnownRequests, withWellKnownNames } from "../folders";
import { childFoldersPath, fetchFolders, fetchWellKnownIds, FOLDERS_PATH } from "../hooks";
import { folderByNamePath } from "../labels";
import { orderFolders, resolveFolderId, visibleFolders } from "../logic";
import type { MailFolder } from "../types";

const call = <T,>(method: string, path: string) => handleMail(method, new URL(`https://graph.microsoft.com/v1.0${path}`), undefined) as T;
// The mock's $batch (lib/mock/index.ts) turns a thrown handler error into a failed sub-request.
const batch = async (reqs: BatchRequest[]): Promise<BatchResponse[]> =>
  reqs.map((r) => {
    try {
      return { id: r.id, status: 200, body: call<unknown>(r.method, r.url) };
    } catch (e) {
      return { id: r.id, status: e instanceof GraphError ? e.status : 500, body: { error: { code: "x", message: String(e) } } };
    }
  });
const get = async <T,>(path: string) => call<T>("GET", path);

describe("well-known folders on Graph v1.0", () => {
  it("never asks for wellKnownName: it is beta-only and v1.0 answers 400", () => {
    for (const path of [FOLDERS_PATH, childFoldersPath("f-partners"), folderByNamePath("GSI")]) {
      expect(path).not.toMatch(/wellKnownName/i);
      expect(() => call("GET", path)).not.toThrow();
    }
    expect(FOLDER_SELECT.split(",")).toEqual(["id", "displayName", "parentFolderId", "childFolderCount", "unreadItemCount", "totalItemCount"]);
    const bad = `/me/mailFolders?$select=id,displayName,wellKnownName&$top=100`;
    expect(() => call("GET", bad)).toThrow(/Could not find a property named 'wellKnownName' on type 'microsoft.graph.mailFolder'/);
    expect(() => call("GET", "/me/mailFolders/f-partners/childFolders?$select=id,wellKnownName")).toThrow(/wellKnownName/);
    expect(() => call("GET", "/me/mailFolders/inbox?$select=id,wellKnownName")).toThrow(/wellKnownName/);
    // The listed folders carry no wellKnownName at all, as on v1.0.
    const listed = call<{ value: MailFolder[] }>("GET", FOLDERS_PATH).value;
    expect(listed.every((f) => !("wellKnownName" in f))).toBe(true);
  });

  it("resolves the ids through one $batch of alias GETs; a missing folder is skipped, never fatal", async () => {
    const reqs = wellKnownRequests();
    expect(reqs).toHaveLength(WELL_KNOWN_ALIASES.length);
    expect(reqs.length).toBeLessThanOrEqual(20); // one $batch call
    expect(reqs.find((r) => r.id === "inbox")).toEqual({ id: "inbox", method: "GET", url: "/me/mailFolders/inbox?$select=id" });
    const map = await fetchWellKnownIds(batch);
    expect(map["f-inbox"]).toBe("inbox");
    expect(map["f-sent"]).toBe("sentitems");
    expect(map["f-deleted"]).toBe("deleteditems");
    expect(map["f-junk"]).toBe("junkemail");
    expect(map["f-archive"]).toBe("archive");
    expect(map["f-drafts"]).toBe("drafts");
    expect(Object.values(map)).not.toContain("outbox"); // the demo mailbox has none: 404 in the batch
    // Error bodies with a 200 status (the mock's not-found shape) and unknown request ids are ignored.
    expect(wellKnownIdsFrom([{ id: "inbox", status: 200, body: { error: { code: "ErrorItemNotFound" } } }, { id: "nope", status: 200, body: { id: "x" } }, { id: "drafts", status: 404 }])).toEqual({});
  });

  it("stamps wellKnownName client-side so ordering, hiding, keys and counts work unchanged", async () => {
    const folders = await fetchFolders(get, () => fetchWellKnownIds(batch));
    expect(folders.find((f) => f.id === "f-inbox")?.wellKnownName).toBe("inbox");
    expect(folders.find((f) => f.id === "f-partners")?.wellKnownName).toBeNull();
    expect(orderFolders(visibleFolders(folders)).slice(0, 6).map((f) => f.wellKnownName)).toEqual(["inbox", "sentitems", "drafts", "archive", "junkemail", "deleteditems"]);
    expect(resolveFolderId("deleteditems", folders)).toBe("f-deleted");
    expect(withWellKnownNames([{ id: "a", displayName: "Outbox" }], { a: "outbox" })[0].wellKnownName).toBe("outbox");
  });

  it("falls back to the default display names when the alias batch itself fails", async () => {
    const folders = await fetchFolders(get, async () => {
      throw new Error("offline");
    });
    expect(folders.find((f) => f.displayName === "Inbox")?.wellKnownName).toBe("inbox");
    expect(folders.find((f) => f.displayName === "Junk Email")?.wellKnownName).toBe("junkemail");
    expect(folders.find((f) => f.displayName === "GSI Partners")?.wellKnownName).toBeNull();
    expect(guessWellKnownByName([{ id: "1", displayName: "  sent items " }, { id: "2", displayName: "Sent" }])).toEqual({ "1": "sentitems" });
    expect(mockFolders.every((f) => !("wellKnownName" in f))).toBe(true);
  });
});
