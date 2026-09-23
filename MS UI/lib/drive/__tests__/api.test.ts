import { afterEach, describe, expect, it, vi } from "vitest";
import type { IPublicClientApplication } from "@azure/msal-browser";
import { copyItem, fetchThumbnail, invite, itemPath } from "../api";
import { indexKey, isUsableStore } from "../index";

vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: {}, accounts: [] }) }));

const instance = {
  getActiveAccount: () => ({ homeAccountId: "acc" }),
  getAllAccounts: () => [{ homeAccountId: "acc" }],
  acquireTokenSilent: async () => ({ accessToken: "tok" }),
} as unknown as IPublicClientApplication;

type Call = { url: string; init?: RequestInit };
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }));
  return calls;
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("itemPath", () => {
  it("encodes ids so a crafted URL cannot change the Graph path", () => {
    expect(itemPath("root")).toBe("/me/drive/root");
    expect(itemPath("01ABC!123")).toBe("/me/drive/items/01ABC!123");
    expect(itemPath("x/children?$top=1#")).toBe("/me/drive/items/x%2Fchildren%3F%24top%3D1%23");
  });
});

describe("copyItem", () => {
  it("sends conflictBehavior=rename with the destination driveId + id, and polls the monitor without auth", async () => {
    vi.useFakeTimers();
    let polls = 0;
    const calls = stubFetch((url) => {
      if (url.includes("/copy")) return new Response(null, { status: 202, headers: { Location: "https://contoso.sharepoint.com/_api/v2.0/monitor/1" } });
      polls++;
      return json(polls < 2 ? { status: "inProgress", percentageComplete: 40 } : { status: "completed", percentageComplete: 100 });
    });
    const pct: number[] = [];
    const p = copyItem(instance, "src", { driveId: "b!dest", id: "ROOTID" }, undefined, (n) => pct.push(n));
    await vi.runAllTimersAsync();
    expect(await p).toBe("completed");
    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/drive/items/src/copy?@microsoft.graph.conflictBehavior=rename");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ parentReference: { driveId: "b!dest", id: "ROOTID" } });
    expect(calls[1].url).toBe("https://contoso.sharepoint.com/_api/v2.0/monitor/1");
    expect(calls[1].init).toBeUndefined(); // plain fetch, no Authorization header
    expect(pct).toEqual([40, 100]);
  });
  it("resolves 'unknown' when the Location header is not exposed", async () => {
    stubFetch(() => new Response(null, { status: 202 }));
    expect(await copyItem(instance, "src", { driveId: "d", id: "r" })).toBe("unknown");
  });
  it("resolves 'unknown' when the monitor cannot be read cross-origin, and fails on a failed status", async () => {
    vi.useFakeTimers();
    stubFetch((url) => {
      if (url.includes("/copy")) return new Response(null, { status: 202, headers: { Location: "https://contoso.sharepoint.com/_api/v2.0/monitor/2" } });
      throw new TypeError("Failed to fetch");
    });
    const p1 = copyItem(instance, "src", { driveId: "d", id: "r" });
    await vi.runAllTimersAsync();
    expect(await p1).toBe("unknown");
    stubFetch((url) => {
      if (url.includes("/copy")) return new Response(null, { status: 202, headers: { Location: "https://contoso.sharepoint.com/_api/v2.0/monitor/3" } });
      return json({ status: "failed", error: { message: "Errors occurred during copy/move operation.", details: [{ code: "nameAlreadyExists", message: "Name already exists" }] } });
    });
    const p2 = copyItem(instance, "src", { driveId: "d", id: "r" });
    p2.catch(() => undefined);
    await vi.runAllTimersAsync();
    await expect(p2).rejects.toThrow(/Name already exists/);
  });
  it("throws a GraphError when the copy request itself is rejected", async () => {
    stubFetch(() => json({ error: { code: "invalidRequest", message: "Cannot copy the root folder." } }, 400));
    await expect(copyItem(instance, "root", { driveId: "d", id: "r" })).rejects.toThrow(/Cannot copy the root folder/);
  });
});

describe("fetchThumbnail", () => {
  it("reads the thumbnail JSON url instead of following a 302 from /content", async () => {
    const calls = stubFetch(() => json({ width: 176, height: 117, url: "https://files.sharepoint.com/thumb.jpg" }));
    expect(await fetchThumbnail(instance, "01ABC")).toBe("https://files.sharepoint.com/thumb.jpg");
    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/drive/items/01ABC/thumbnails/0/medium");
  });
  it("returns null when there is no thumbnail", async () => {
    stubFetch(() => json({ error: { code: "itemNotFound", message: "no thumbnail" } }, 404));
    expect(await fetchThumbnail(instance, "01ABC")).toBeNull();
  });
});

describe("index store cache", () => {
  it("namespaces the IndexedDB key by mode and account", () => {
    expect(indexKey("acc-1", false)).toBe("msui.drive.index.v2.live.acc-1");
    expect(indexKey("acc-1", true)).toBe("msui.drive.index.v2.mock.acc-1");
    expect(indexKey(undefined, false)).toBe("msui.drive.index.v2.live.anon");
  });
  it("never reuses a mock deltaLink in real mode, nor a rootless store", () => {
    const items = { a: { id: "a", name: "A" } };
    const mock = { items, rootId: "R", deltaLink: "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=mock-1" };
    expect(isUsableStore(mock, true)).toBe(true);
    expect(isUsableStore(mock, false)).toBe(false);
    expect(isUsableStore({ items, deltaLink: "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=abc" }, false)).toBe(false);
    expect(isUsableStore({ items, rootId: "R", deltaLink: "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=abc" }, false)).toBe(true);
    expect(isUsableStore({ items, rootId: "R", deltaLink: "https://evil.example/delta" }, false)).toBe(false);
    expect(isUsableStore({ items: {} }, false)).toBe(false);
    expect(isUsableStore(undefined, false)).toBe(false);
  });
});

describe("invite", () => {
  it("posts the documented body and keeps per-recipient errors from a 207 Multi-Status answer", async () => {
    const calls = stubFetch(() =>
      json(
        {
          value: [
            { id: "p1", roles: ["write"], invitation: { email: "helga@contoso.com", signInRequired: true }, error: { code: "notAllowed", message: "Account verification needed to unblock sending emails." } },
            { id: "p2", roles: ["write"], invitation: { email: "robin@contoso.com", signInRequired: true } },
          ],
        },
        207
      )
    );
    const res = await invite(instance, "01ABC", ["helga@contoso.com", "robin@contoso.com"], "write", "");
    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/drive/items/01ABC/invite");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ recipients: [{ email: "helga@contoso.com" }, { email: "robin@contoso.com" }], roles: ["write"], requireSignIn: true, sendInvitation: true });
    expect(res.value.filter((p) => p.error).map((p) => p.invitation?.email)).toEqual(["helga@contoso.com"]);
  });
});
