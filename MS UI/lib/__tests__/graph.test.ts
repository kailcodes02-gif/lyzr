import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InteractionRequiredAuthError, type IPublicClientApplication } from "@azure/msal-browser";
import { ConsentRequiredError, dedupeBatchRequests, graphBatch, graphFetch, graphGetAll, GraphError, isConsentRequiredError, redirectMarkerKey, wantsImmutableIds } from "../graph";

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
  it("drops the immutable-id Prefer on a percent-encoded nextLink search page", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ value: [] }));
    await graphFetch(instance, ["Mail.ReadWrite"], "https://graph.microsoft.com/v1.0/me/messages?%24select=id&%24search=%22x%22&%24top=50&%24skip=50");
    const h = spy.mock.calls[0][1]!.headers as Record<string, string>;
    expect(h.Prefer ?? "").not.toContain("ImmutableId");
    // Case-insensitive too (Graph is not consistent about %24 vs %24 casing).
    expect(wantsImmutableIds("/me/messages?%24SEARCH=%22x%22")).toBe(false);
    expect(wantsImmutableIds("/me/messages?$select=id&$top=50")).toBe(true);
    expect(wantsImmutableIds("/me/drive/root")).toBe(false);
    // An explicit opt-out wins; an explicit opt-in still never applies to search.
    expect(wantsImmutableIds("/me/messages", false)).toBe(false);
    expect(wantsImmutableIds('/me/messages?$search="x"', true)).toBe(false);
  });
  it("keeps a caller-supplied Prefer alongside the immutable-id one, without duplicating it", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json({ value: [] }));
    await graphFetch(instance, ["Mail.ReadWrite"], "/me/messages", { headers: { Prefer: 'outlook.body-content-type="text"' } });
    await graphFetch(instance, ["Mail.ReadWrite"], "/me/messages", { headers: { Prefer: 'IdType="ImmutableId"' } });
    const h1 = spy.mock.calls[0][1]!.headers as Record<string, string>;
    const h2 = spy.mock.calls[1][1]!.headers as Record<string, string>;
    expect(h1.Prefer).toBe('outlook.body-content-type="text", IdType="ImmutableId"');
    expect(h2.Prefer).toBe('IdType="ImmutableId"');
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
  it("adds the immutable-id Prefer to each mail sub-request (outer headers do not propagate)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      const body = JSON.parse(init!.body as string) as { requests: { id: string; headers?: Record<string, string> }[] };
      return json({ responses: body.requests.map((r) => ({ id: r.id, status: 200 })) });
    });
    await graphBatch(instance, ["Mail.ReadWrite"], [
      { id: "0", method: "PATCH", url: "/me/messages/a", body: { isRead: true } },
      { id: "1", method: "DELETE", url: "/me/messages/b" },
      { id: "2", method: "GET", url: "/me/drive/root" },
    ]);
    const sent = JSON.parse(spy.mock.calls[0][1]!.body as string) as { requests: { headers?: Record<string, string> }[] };
    expect(sent.requests[0].headers).toEqual({ "Content-Type": "application/json", Prefer: 'IdType="ImmutableId"' });
    expect(sent.requests[1].headers).toEqual({ Prefer: 'IdType="ImmutableId"' });
    expect(sent.requests[2].headers).toBeUndefined();
    // The outer $batch POST itself must not carry the mail Prefer.
    const outer = spy.mock.calls[0][1]!.headers as Record<string, string>;
    expect(outer.Prefer ?? "").not.toContain("ImmutableId");
  });
  it("sends sequential wire ids and maps responses back to the caller's ids", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      const body = JSON.parse(init!.body as string) as { requests: { id: string }[] };
      // Out of order, as Graph may answer.
      return json({ responses: body.requests.map((r) => ({ id: r.id, status: 200, body: { wire: r.id } })).reverse() });
    });
    const out = await graphBatch(instance, ["Mail.ReadWrite"], [
      { id: "AAMk-a", method: "PATCH", url: "/me/messages/AAMk-a", body: { isRead: true } },
      { id: "AAMk-b", method: "PATCH", url: "/me/messages/AAMk-b", body: { isRead: true } },
    ]);
    const sent = JSON.parse(spy.mock.calls[0][1]!.body as string) as { requests: { id: string }[] };
    expect(sent.requests.map((r) => r.id)).toEqual(["1", "2"]);
    expect(out).toEqual([
      { id: "AAMk-a", status: 200, body: { wire: "1" } },
      { id: "AAMk-b", status: 200, body: { wire: "2" } },
    ]);
  });
  it("de-duplicates identical requests with a repeated id and fans the one response out (the 'Request Id has to be unique' case)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      const body = JSON.parse(init!.body as string) as { requests: { id: string }[] };
      const ids = body.requests.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      return json({ responses: body.requests.map((r) => ({ id: r.id, status: 201, body: { id: `new-${r.id}` } })) });
    });
    const move = (id: string) => ({ id, method: "POST", url: `/me/messages/${id}/move`, body: { destinationId: "archive" } });
    // 100 selected ids, only 30 distinct: two $batch calls of 20 + 10.
    const reqs = Array.from({ length: 100 }, (_, i) => move(`m${i % 30}`));
    const out = await graphBatch(instance, ["Mail.ReadWrite"], reqs);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(spy.mock.calls[0][1]!.body as string).requests).toHaveLength(20);
    expect(JSON.parse(spy.mock.calls[1][1]!.body as string).requests).toHaveLength(10);
    expect(out).toHaveLength(30);
    expect(out.map((r) => r.id)).toEqual(Array.from({ length: 30 }, (_, i) => `m${i}`));
    expect(out.every((r) => r.status === 201)).toBe(true);
  });
  it("keeps two different requests that share a caller id and answers both under that id", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      const body = JSON.parse(init!.body as string) as { requests: { id: string; url: string }[] };
      return json({ responses: body.requests.map((r) => ({ id: r.id, status: 200, body: { url: r.url } })) });
    });
    const out = await graphBatch(instance, ["Mail.ReadWrite"], [
      { id: "x", method: "GET", url: "/me/mailFolders/inbox" },
      { id: "x", method: "GET", url: "/me/mailFolders/archive" },
    ]);
    expect(out.map((r) => [r.id, (r.body as { url: string }).url])).toEqual([["x", "/me/mailFolders/inbox"], ["x", "/me/mailFolders/archive"]]);
  });
  it("dedupeBatchRequests keys on method, url and body", () => {
    const u = dedupeBatchRequests([
      { id: "a", method: "PATCH", url: "/me/messages/a", body: { isRead: true } },
      { id: "a", method: "PATCH", url: "/me/messages/a", body: { isRead: true } },
      { id: "a", method: "PATCH", url: "/me/messages/a", body: { isRead: false } },
      { id: "b", method: "PATCH", url: "/me/messages/a", body: { isRead: true } },
    ]);
    expect(u.map((e) => [e.req.body, e.callerIds])).toEqual([[{ isRead: true }, ["a", "b"]], [{ isRead: false }, ["a"]]]);
  });
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

describe("isConsentRequiredError", () => {
  // MSAL's signature: (errorCode, correlationId, errorMessage, subError, timestamp, traceId, claims, errorNo)
  const ira = (subError?: string, errorNo?: string) =>
    new InteractionRequiredAuthError("interaction_required", "", "AADSTS50076: MFA", subError, "", "", "", errorNo);
  it("is true for ConsentRequiredError, Graph 401/403 and consent-flavoured MSAL errors", () => {
    expect(isConsentRequiredError(new ConsentRequiredError(["Mail.ReadWrite"], "x"))).toBe(true);
    expect(isConsentRequiredError(new GraphError(401, "InvalidAuthenticationToken", "m", "/me"))).toBe(true);
    expect(isConsentRequiredError(new GraphError(403, "ErrorAccessDenied", "m", "/me"))).toBe(true);
    expect(isConsentRequiredError(ira("consent_required"))).toBe(true);
    expect(isConsentRequiredError(ira(undefined, "65001"))).toBe(true);
    expect(isConsentRequiredError(ira(undefined, "90094"))).toBe(true);
  });
  it("is false for other Graph statuses, session-type MSAL errors and plain errors", () => {
    expect(isConsentRequiredError(new GraphError(404, "ErrorItemNotFound", "m", "/me"))).toBe(false);
    expect(isConsentRequiredError(new GraphError(429, "Throttled", "m", "/me"))).toBe(false);
    expect(isConsentRequiredError(ira())).toBe(false);
    expect(isConsentRequiredError(new Error("boom"))).toBe(false);
    expect(isConsentRequiredError(null)).toBe(false);
    expect(isConsentRequiredError(undefined)).toBe(false);
  });
});

describe("getToken redirect guard", () => {
  // A fresh module per test: the in-flight redirect promise is module state.
  type Graph = typeof import("../graph");
  let g: Graph;
  const sessionErr = () => new InteractionRequiredAuthError("interaction_required", "", "AADSTS50076: MFA");
  const mkInstance = (redirect: () => Promise<void>) =>
    ({
      getActiveAccount: () => ({ homeAccountId: "x", username: "u" }),
      getAllAccounts: () => [{ homeAccountId: "x", username: "u" }],
      acquireTokenSilent: vi.fn(async () => {
        throw sessionErr();
      }),
      acquireTokenRedirect: vi.fn(redirect),
    }) as unknown as IPublicClientApplication;
  const settle = <T,>(p: Promise<T>) =>
    Promise.race([p.then(() => "resolved" as const, () => "rejected" as const), new Promise<"pending">((r) => setTimeout(() => r("pending"), 20))]);

  beforeEach(async () => {
    sessionStorage.clear();
    vi.resetModules();
    g = await import("../graph");
  });

  it("starts ONE acquireTokenRedirect for parallel calls with different scope sets and keeps them all pending", async () => {
    const inst = mkInstance(() => new Promise(() => {}));
    const a = g.getToken(inst, ["Mail.ReadWrite"]);
    const b = g.getToken(inst, ["Files.ReadWrite"]);
    const c = g.getToken(inst, ["Calendars.ReadWrite", "Calendars.Read.Shared"]);
    await expect(Promise.all([settle(a), settle(b), settle(c)])).resolves.toEqual(["pending", "pending", "pending"]);
    expect(inst.acquireTokenRedirect).toHaveBeenCalledTimes(1);
    expect(inst.acquireTokenRedirect).toHaveBeenCalledWith(expect.objectContaining({ scopes: ["Mail.ReadWrite"] }));
    // Only the scope set that actually redirected is marked; the others may
    // still redirect after we come back.
    expect(sessionStorage.getItem(redirectMarkerKey(["Mail.ReadWrite"]))).toBe("1");
    expect(sessionStorage.getItem(redirectMarkerKey(["Files.ReadWrite"]))).toBeNull();
    expect(sessionStorage.getItem(redirectMarkerKey(["Calendars.Read.Shared", "Calendars.ReadWrite"]))).toBeNull();
  });

  it("when the redirect cannot start, every waiter rejects, the marker is rolled back and a later call may redirect again", async () => {
    const inst = mkInstance(async () => {
      throw new Error("interaction_in_progress");
    });
    const a = g.getToken(inst, ["Mail.ReadWrite"]);
    const b = g.getToken(inst, ["Files.ReadWrite"]);
    await expect(a).rejects.toThrow("interaction_in_progress");
    await expect(b).rejects.toThrow("interaction_in_progress");
    expect(inst.acquireTokenRedirect).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(redirectMarkerKey(["Mail.ReadWrite"]))).toBeNull();
    // Guard released: the next failure redirects again rather than throwing.
    const inst2 = mkInstance(() => new Promise(() => {}));
    await expect(settle(g.getToken(inst2, ["Mail.ReadWrite"]))).resolves.toBe("pending");
    expect(inst2.acquireTokenRedirect).toHaveBeenCalledTimes(1);
  });

  it("after returning from a redirect that still fails, surfaces the MSAL error instead of looping", async () => {
    sessionStorage.setItem(redirectMarkerKey(["Mail.ReadWrite"]), "1");
    const inst = mkInstance(() => new Promise(() => {}));
    await expect(g.getToken(inst, ["Mail.ReadWrite"])).rejects.toBeInstanceOf(InteractionRequiredAuthError);
    expect(inst.acquireTokenRedirect).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(redirectMarkerKey(["Mail.ReadWrite"]))).toBeNull();
  });

  it("throws ConsentRequiredError without redirecting when the tenant has not approved the scope", async () => {
    const inst = mkInstance(() => new Promise(() => {}));
    (inst.acquireTokenSilent as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new InteractionRequiredAuthError("invalid_grant", "", "AADSTS65001: consent", "consent_required");
    });
    await expect(g.getToken(inst, ["Mail.ReadWrite"])).rejects.toBeInstanceOf(g.ConsentRequiredError);
    expect(inst.acquireTokenRedirect).not.toHaveBeenCalled();
  });
});
