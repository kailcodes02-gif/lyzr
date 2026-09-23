import { afterEach, describe, expect, it, vi } from "vitest";
import type { IPublicClientApplication } from "@azure/msal-browser";
import { enqueueUploads, SESSION_GONE } from "../upload";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [] }) }));

const instance = {
  getActiveAccount: () => ({ homeAccountId: "acc" }),
  getAllAccounts: () => [{ homeAccountId: "acc" }],
  acquireTokenSilent: async () => ({ accessToken: "tok" }),
} as unknown as IPublicClientApplication;

type Call = { url: string; init?: RequestInit };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("large upload session", () => {
  it("creates the session with conflictBehavior, PUTs 320 KiB-aligned chunks without auth or Content-Length, and finishes on 201", async () => {
    const size = 5 * 1024 * 1024; // above SIMPLE_UPLOAD_LIMIT, below one chunk
    const file = new File([new Uint8Array(size)], "big.bin", { type: "application/octet-stream" });
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes("createUploadSession")) return json({ uploadUrl: "https://up.example/session/1", nextExpectedRanges: ["0-"] });
        return json({ id: "NEW", name: "big.bin", size }, 201);
      })
    );
    const created = await enqueueUploads(instance, [{ file, parentId: "PARENT" }]);
    expect(created.map((c) => c.id)).toEqual(["NEW"]);
    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/drive/items/PARENT:/big.bin:/createUploadSession");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ item: { "@microsoft.graph.conflictBehavior": "rename", name: "big.bin" } });
    const put = calls[1];
    expect(put.url).toBe("https://up.example/session/1");
    expect(put.init?.method).toBe("PUT");
    const headers = put.init?.headers as Record<string, string>;
    expect(headers["Content-Range"]).toBe(`bytes 0-${size - 1}/${size}`);
    expect(headers.Authorization).toBeUndefined();
    expect(headers["Content-Length"]).toBeUndefined();
  });
  it("fails at once when the session is gone (404) instead of retrying", async () => {
    const file = new File([new Uint8Array(5 * 1024 * 1024)], "big.bin");
    let puts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("createUploadSession")) return json({ uploadUrl: "https://up.example/session/2" });
        puts++;
        return new Response(null, { status: 404 });
      })
    );
    const created = await enqueueUploads(instance, [{ file, parentId: "PARENT" }]);
    expect(created).toEqual([]);
    expect(puts).toBe(1);
  });
  it("exposes the expired-session message", () => {
    expect(SESSION_GONE).toMatch(/expired/);
  });
});
