import { describe, expect, it, vi } from "vitest";
import type { IPublicClientApplication } from "@azure/msal-browser";
import { checkExpectation, verifyItems } from "../reconcile";
import type { DriveItem } from "../types";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [] }) }));

const item = (over: Partial<DriveItem> = {}): DriveItem => ({ id: "a", name: "Report.docx", parentReference: { id: "P1" }, ...over });

describe("checkExpectation: the server wins", () => {
  it("decides nothing when the check itself failed", () => {
    expect(checkExpectation({ kind: "move", id: "a", parentId: "P2", label: "x" }, undefined)).toEqual({ id: "a" });
  });
  it("removes an optimistic row the server no longer reports", () => {
    expect(checkExpectation({ kind: "move", id: "a", parentId: "P2", label: "x" }, null)).toEqual({ id: "a", patch: null, failed: "move" });
    expect(checkExpectation({ kind: "exists", id: "a", action: "upload", label: "x" }, null)).toEqual({ id: "a", patch: null, failed: "upload" });
    expect(checkExpectation({ kind: "rename", id: "a", name: "B", label: "x" }, null)).toEqual({ id: "a", patch: null, failed: "rename" });
    // A tombstone counts as gone.
    expect(checkExpectation({ kind: "exists", id: "a", action: "new folder", label: "x" }, item({ deleted: { state: "deleted" } }))).toEqual({ id: "a", patch: null, failed: "new folder" });
  });
  it("puts a move back where the server has it when the move did not apply", () => {
    const server = item({ parentReference: { id: "P1" } });
    expect(checkExpectation({ kind: "move", id: "a", parentId: "P2", label: "x" }, server)).toEqual({ id: "a", patch: server, failed: "move" });
    expect(checkExpectation({ kind: "move", id: "a", parentId: "P1", label: "x" }, server)).toEqual({ id: "a", patch: server });
  });
  it("restores a row the server still has after a delete that did not apply", () => {
    const server = item();
    expect(checkExpectation({ kind: "delete", id: "a", label: "x" }, server)).toEqual({ id: "a", patch: server, failed: "delete" });
    expect(checkExpectation({ kind: "delete", id: "a", label: "x" }, null)).toEqual({ id: "a" });
    expect(checkExpectation({ kind: "delete", id: "a", label: "x" }, item({ deleted: { state: "deleted" } }))).toEqual({ id: "a" });
  });
  it("takes the server's name when a rename was changed on conflict", () => {
    const server = item({ name: "Report 1.docx" });
    expect(checkExpectation({ kind: "rename", id: "a", name: "Report.docx", label: "Old.docx" }, server)).toEqual({ id: "a", patch: server, info: 'OneDrive named it "Report 1.docx"' });
    expect(checkExpectation({ kind: "rename", id: "a", name: "Report 1.docx", label: "Old.docx" }, server)).toEqual({ id: "a", patch: server });
  });
});

describe("verifyItems", () => {
  const instance = {
    getActiveAccount: () => ({ homeAccountId: "acc" }),
    getAllAccounts: () => [{ homeAccountId: "acc" }],
    acquireTokenSilent: async () => ({ accessToken: "tok" }),
  } as unknown as IPublicClientApplication;

  it("asks for every id in one $batch with a minimal $select and maps 404 to null", async () => {
    let batchBody: { requests: { id: string; method: string; url: string }[] } | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        batchBody = JSON.parse(String(init?.body));
        // graphBatch sends its own unique wire ids; answer under those, in order.
        const wire = (batchBody?.requests ?? []).map((r) => r.id);
        return new Response(
          JSON.stringify({
            responses: [
              { id: wire[0], status: 200, body: { id: "a", name: "A", parentReference: { id: "R" } } },
              { id: wire[1], status: 404, body: { error: { code: "itemNotFound" } } },
              { id: wire[2], status: 429, body: { error: { code: "TooManyRequests" } } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      })
    );
    try {
      const r = await verifyItems(instance, ["a", "gone", "busy", "a"]);
      expect(batchBody?.requests).toHaveLength(3);
      expect(batchBody?.requests[0].method).toBe("GET");
      expect(batchBody?.requests[0].url).toMatch(/^\/me\/drive\/items\/a\?\$select=id,name,size,file,folder,deleted,parentReference/);
      expect(batchBody?.requests[0].url).not.toContain("remoteItem");
      expect(r.get("a")).toEqual({ id: "a", name: "A", parentReference: { id: "R" } });
      expect(r.get("gone")).toBeNull();
      expect(r.has("busy")).toBe(true);
      expect(r.get("busy")).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("returns nothing (decide nothing) when the batch itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "BadRequest" } }), { status: 400 })));
    try {
      const r = await verifyItems(instance, ["a"]);
      expect(r.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("reconcile against the demo OneDrive (mock $batch)", () => {
  it("puts back a move OneDrive did not apply, drops a row it no longer has, and adopts a conflict rename", async () => {
    localStorage.setItem("msui.mock", "1");
    try {
      const { reconcile } = await import("../reconcile");
      const { handleDrive, MOCK_ROOT_ID, mockDriveFind } = await import("@/lib/mock/drive");
      const call = <T,>(method: string, path: string, body?: unknown) => handleDrive(method, new URL(`https://graph.microsoft.com/v1.0${path}`), body) as T;
      const notes = mockDriveFind("Notes.txt")!;
      const personal = mockDriveFind("Personal")!;
      // The server renamed on conflict: "Reading list.md" already exists in Personal.
      const renamed = call<DriveItem>("PATCH", `/me/drive/items/${notes.id}`, { name: "Reading list.md" });
      expect(renamed.name).toBe("Reading list 1.md");
      const out = await reconcile({} as IPublicClientApplication, [
        { kind: "move", id: notes.id, parentId: MOCK_ROOT_ID, label: "Notes.txt" }, // never moved on the server
        { kind: "exists", id: "01MOCKNOPE", action: "upload", label: "ghost.pdf" }, // never existed
        { kind: "rename", id: notes.id, name: "Reading list.md", label: "Notes.txt" },
        { kind: "delete", id: personal.id, label: "Personal" }, // never deleted
      ]);
      expect(out[0]).toMatchObject({ id: notes.id, failed: "move", patch: { parentReference: { id: personal.id } } });
      expect(out[1]).toEqual({ id: "01MOCKNOPE", patch: null, failed: "upload" });
      expect(out[2]).toMatchObject({ id: notes.id, info: 'OneDrive named it "Reading list 1.md"', patch: { name: "Reading list 1.md" } });
      expect(out[3]).toMatchObject({ id: personal.id, failed: "delete", patch: { name: "Personal" } });
    } finally {
      localStorage.removeItem("msui.mock");
    }
  });
});
