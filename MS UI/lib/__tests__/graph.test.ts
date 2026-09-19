import { afterEach, describe, expect, it, vi } from "vitest";
import type { IPublicClientApplication } from "@azure/msal-browser";
import { graphBatch, graphFetch, graphGetAll, GraphError } from "../graph";

const instance = {
  getActiveAccount: () => ({ homeAccountId: "x", username: "u" }),
  getAllAccounts: () => [{ homeAccountId: "x", username: "u" }],
  acquireTokenSilent: vi.fn(async () => ({ accessToken: "tok" })),
  acquireTokenRedirect: vi.fn(async () => {}),
} as unknown as IPublicClientApplication;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

afterEach(() => vi.restoreAllMocks());

describe("graphFetch", () => {
  it("sends bearer token, JSON body, and immutable-id Prefer for mail paths", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ ok: 1 }));
    await graphFetch(instance, ["Mail.ReadWrite"], "/me/messages/1", { method: "PATCH", body: { isRead: true } });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/messages/1");
    const h = init!.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer tok");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h.Prefer).toContain('IdType="ImmutableId"');
    expect(init!.body).toBe('{"isRead":true}');
  });
  it("drops the immutable-id Prefer on $search", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ value: [] }));
    await graphFetch(instance, ["Mail.ReadWrite"], '/me/messages?$search="from:x"');
    const h = spy.mock.calls[0][1]!.headers as Record<string, string>;
    expect(h.Prefer ?? "").not.toContain("ImmutableId");
  });
  it("retries once with a fresh token on 401, then throws a GraphError with the Graph code", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ error: { code: "InvalidAuthenticationToken", message: "expired" } }, 401))
      .mockResolvedValueOnce(json({ error: { code: "ErrorItemNotFound", message: "gone" } }, 404));
    await expect(graphFetch(instance, ["Mail.ReadWrite"], "/me/messages/2")).rejects.toMatchObject({ status: 404, code: "ErrorItemNotFound" } satisfies Partial<GraphError>);
    expect(instance.acquireTokenSilent).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }));
  });
  it("honours Retry-After on 429", async () => {
    vi.useFakeTimers();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({}, 429, { "Retry-After": "1" }))
      .mockResolvedValueOnce(json({ done: true }));
    const p = graphFetch(instance, ["Files.ReadWrite"], "/me/drive/root");
    await vi.advanceTimersByTimeAsync(1100);
    await expect(p).resolves.toEqual({ done: true });
    expect(spy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
  it("returns undefined on 204", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(graphFetch(instance, ["Mail.ReadWrite"], "/me/messages/3", { method: "DELETE" })).resolves.toBeUndefined();
  });
});

describe("graphGetAll", () => {
  it("follows nextLink up to max", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ value: [1, 2], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next" }))
      .mockResolvedValueOnce(json({ value: [3, 4] }));
    await expect(graphGetAll<number>(instance, ["x"], "/me/things", 3)).resolves.toEqual([1, 2, 3]);
  });
});

describe("graphBatch", () => {
  it("chunks into 20 and strips the Graph prefix", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      const body = JSON.parse(init!.body as string) as { requests: { id: string; url: string }[] };
      expect(body.requests.length).toBeLessThanOrEqual(20);
      return json({ responses: body.requests.map((r) => ({ id: r.id, status: 200, body: { url: r.url } })) });
    });
    const reqs = Array.from({ length: 25 }, (_, i) => ({ id: String(i), method: "GET", url: `https://graph.microsoft.com/v1.0/me/messages/${i}` }));
    const out = await graphBatch(instance, ["Mail.ReadWrite"], reqs);
    expect(out).toHaveLength(25);
    expect(out[0].body).toEqual({ url: "/me/messages/0" });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
