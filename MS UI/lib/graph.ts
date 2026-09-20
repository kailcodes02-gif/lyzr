"use client";

import { InteractionRequiredAuthError, type IPublicClientApplication } from "@azure/msal-browser";
import { GRAPH } from "./config";
import { isMockMode, mockGraph } from "./mock";

export class GraphError extends Error {
  constructor(public status: number, public code: string, message: string, public path: string) {
    super(message);
    this.name = "GraphError";
  }
}

export type ConsentState = "granted" | "needs-admin" | "reauth" | "unknown";

// Thrown instead of redirecting when the tenant has not approved a scope:
// sending the user to Entra's "Need admin approval" page would strand them.
export class ConsentRequiredError extends Error {
  constructor(public scopes: string[], public detail: string) {
    super(`Admin approval needed for ${scopes.join(", ")}`);
    this.name = "ConsentRequiredError";
  }
}

// consent_required sub-error, AADSTS65001 (consent required) or AADSTS90094
// (admin consent required). errorNo is the most reliable signal (it is
// serverResponse.error_codes[0]); the message regex is a fallback.
export function isConsentRequired(e: InteractionRequiredAuthError): boolean {
  const errNo = String(e.errorNo ?? "");
  return e.subError === "consent_required" || /^(65001|90094)$/.test(errNo) || /AADSTS(65001|90094)/.test(e.errorMessage);
}

// True for any failure that the consent panel should explain rather than a
// generic error: our own ConsentRequiredError, a Graph 401/403 (scope not
// granted yet), or an MSAL interaction error that names consent.
export function isConsentRequiredError(e: unknown): boolean {
  if (e instanceof ConsentRequiredError) return true;
  if (e instanceof GraphError) return e.status === 401 || e.status === 403;
  if (e instanceof InteractionRequiredAuthError) return isConsentRequired(e);
  return false;
}

export const REDIRECT_MARKER = "msui.redirect";
export const redirectMarkerKey = (scopes: string[]) => `${REDIRECT_MARKER}:${scopes.slice().sort().join(" ")}`;

// One redirect at a time for the whole page. Parallel queries (folders, list,
// categories, me) all hit the same expired session at once; only the first
// may call acquireTokenRedirect, the rest wait on the same promise. It never
// resolves (the page is leaving), and it rejects only if MSAL could not
// start the navigation, in which case the next call may try again.
let redirectInFlight: Promise<never> | null = null;

function startRedirect(instance: IPublicClientApplication, scopes: string[], acc: ReturnType<typeof account>, original: unknown): Promise<never> {
  if (redirectInFlight) return redirectInFlight;
  // One redirect attempt per scope set per session.
  const key = redirectMarkerKey(scopes);
  let seen = false;
  try {
    seen = sessionStorage.getItem(key) === "1";
    if (seen) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, "1");
  } catch {
    // storage blocked: fall through to a single redirect
  }
  // Already redirected once for these scopes and came back still failing:
  // surface the original MSAL error instead of looping through Entra.
  if (seen) return Promise.reject(original);
  // Deferred one microtask so `redirectInFlight` is assigned before the call
  // can fail (a synchronous throw would otherwise leave a stale promise).
  const p: Promise<never> = Promise.resolve()
    .then(() => instance.acquireTokenRedirect({ scopes, account: acc, redirectStartPage: window.location.href }))
    .then(
      // The page is navigating away; keep callers (React Query) pending so
      // they do not treat the in-flight redirect as a failure.
      () => new Promise<never>(() => {}),
      (e: unknown) => {
        // Navigation never started: undo the marker so the next attempt is
        // not mistaken for a returning redirect, and let callers retry.
        redirectInFlight = null;
        try {
          sessionStorage.removeItem(key);
        } catch {
          // storage blocked
        }
        throw e;
      }
    );
  redirectInFlight = p;
  return p;
}

function account(instance: IPublicClientApplication) {
  const a = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  if (!a) throw new Error("Not signed in");
  return a;
}

// Silent-only probe: tells whether a scope is already consented without ever
// navigating away. Used by the consent status panel.
export async function probeScopes(instance: IPublicClientApplication, scopes: string[]): Promise<{ state: ConsentState; detail: string }> {
  if (isMockMode()) return { state: "granted", detail: "mock" };
  try {
    await instance.acquireTokenSilent({ scopes, account: account(instance) });
    return { state: "granted", detail: "" };
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      const code = e.errorCode || "";
      const sub = e.subError || "";
      const errNo = String(e.errorNo ?? "");
      const detail = `${code}${sub ? " / " + sub : ""}${errNo ? " (AADSTS" + errNo + ")" : ""}`;
      if (isConsentRequired(e)) return { state: "needs-admin", detail };
      // Anything else interaction-required is about the user's session
      // (MFA, Conditional Access, expired password, dead refresh token).
      return { state: "reauth", detail };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { state: "unknown", detail: msg.slice(0, 160) };
  }
}

// Token for a Graph call. Silent first; if Microsoft insists on interaction
// (expired session, new scope) the whole page redirects, which is the only
// path that works in every browser (hidden iframes die in Safari/Brave).
export async function getToken(instance: IPublicClientApplication, scopes: string[]): Promise<string> {
  const acc = account(instance);
  try {
    const r = await instance.acquireTokenSilent({ scopes, account: acc });
    return r.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      if (isConsentRequired(e)) throw new ConsentRequiredError(scopes, `${e.errorCode}${e.subError ? " / " + e.subError : ""}`);
      return startRedirect(instance, scopes, acc, e);
    }
    throw e;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type GraphInit = {
  method?: string;
  body?: unknown; // objects are JSON-encoded; strings/Blobs/ArrayBuffers sent as-is
  headers?: Record<string, string>;
  // Outlook: immutable ids survive moves between folders. Off automatically
  // on $search (a Microsoft-reproduced bug returns ErrorInvalidIdMalformed).
  immutableIds?: boolean;
};

const IMMUTABLE_ID_PREFER = 'IdType="ImmutableId"';

// Whether a request should carry Prefer: IdType="ImmutableId". Mail paths
// yes, unless the URL is a $search: Graph's @odata.nextLink re-encodes the
// query options (`%24search=`), so the check is encoding- and case-insensitive.
export function wantsImmutableIds(url: string, immutableIds?: boolean): boolean {
  const wants = immutableIds ?? /\/me\/(messages|mailFolders)/i.test(url);
  return wants && !/(\$|%24)search=/i.test(url);
}

function withImmutablePrefer(headers: Record<string, string>): Record<string, string> {
  const existing = headers.Prefer ?? "";
  if (existing.includes(IMMUTABLE_ID_PREFER)) return headers;
  return { ...headers, Prefer: [existing, IMMUTABLE_ID_PREFER].filter(Boolean).join(", ") };
}

function buildHeaders(url: string, init: GraphInit, token: string): Record<string, string> {
  let h: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.headers ?? {}) };
  if (wantsImmutableIds(url, init.immutableIds)) h = withImmutablePrefer(h);
  if (init.body !== undefined && !(init.body instanceof Blob) && !(init.body instanceof ArrayBuffer) && typeof init.body !== "string") {
    h["Content-Type"] = "application/json";
  }
  return h;
}

async function graphRaw(instance: IPublicClientApplication, scopes: string[], path: string, init: GraphInit = {}): Promise<Response> {
  const url = path.startsWith("https://") ? path : `${GRAPH}${path}`;
  const method = init.method ?? "GET";
  const body =
    init.body === undefined || init.body instanceof Blob || init.body instanceof ArrayBuffer || typeof init.body === "string"
      ? (init.body as BodyInit | undefined)
      : JSON.stringify(init.body);
  let token = await getToken(instance, scopes);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { method, body, headers: buildHeaders(url, init, token) });
    if (res.status === 401 && attempt === 0) {
      token = (await instance.acquireTokenSilent({ scopes, account: account(instance), forceRefresh: true })).accessToken;
      continue;
    }
    if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 3) {
      const retry = Number(res.headers.get("Retry-After") ?? "0");
      await sleep((retry > 0 ? retry : 2 ** attempt) * 1000);
      continue;
    }
    if (!res.ok) {
      let code = String(res.status);
      let message = res.statusText;
      try {
        const b = (await res.json()) as { error?: { code?: string; message?: string } };
        code = b.error?.code ?? code;
        message = b.error?.message ?? message;
      } catch {
        // non-JSON error body
      }
      throw new GraphError(res.status, code, message, path);
    }
    return res;
  }
  throw new GraphError(429, "Throttled", "Gave up after retries", path);
}

// JSON request. 202/204 resolve to undefined.
export async function graphFetch<T>(instance: IPublicClientApplication, scopes: string[], path: string, init: GraphInit = {}): Promise<T> {
  if (isMockMode()) return (await mockGraph(path, init.method ?? "GET", init.body)) as T;
  const res = await graphRaw(instance, scopes, path, init);
  if (res.status === 202 || res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// Binary request (attachment $value, thumbnails, file content).
export async function graphFetchBlob(instance: IPublicClientApplication, scopes: string[], path: string, init: GraphInit = {}): Promise<Blob> {
  if (isMockMode()) {
    // Mock handlers return { contentBytes, contentType } or a string for binary paths.
    const data = (await mockGraph(path, init.method ?? "GET", init.body)) as { contentBytes?: string; contentType?: string } | string | undefined;
    if (typeof data === "string") return new Blob([data], { type: "text/plain" });
    const b64 = data?.contentBytes ?? "";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: data?.contentType ?? "application/octet-stream" });
  }
  const res = await graphRaw(instance, scopes, path, { ...init, headers: { Accept: "*/*", ...(init.headers ?? {}) } });
  return res.blob();
}

export type Page<T> = { value: T[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };

// Follows @odata.nextLink until `max` items or the end.
export async function graphGetAll<T>(instance: IPublicClientApplication, scopes: string[], path: string, max = 1000, init: GraphInit = {}): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined = path;
  while (url && out.length < max) {
    const page: Page<T> = await graphFetch<Page<T>>(instance, scopes, url, init);
    out.push(...page.value);
    url = page["@odata.nextLink"];
  }
  return out.slice(0, max);
}

export type BatchRequest = { id: string; method: string; url: string; headers?: Record<string, string>; body?: unknown };
export type BatchResponse = { id: string; status: number; headers?: Record<string, string>; body?: unknown };

// JSON batching, 20 requests per call, in order. Failed sub-requests are
// returned with their status rather than thrown. Headers on the outer POST
// do not reach the sub-requests, so the immutable-id Prefer is added to each
// mail sub-request here (ids must match what lists and threads carry).
export async function graphBatch(instance: IPublicClientApplication, scopes: string[], requests: BatchRequest[]): Promise<BatchResponse[]> {
  const out: BatchResponse[] = [];
  for (let i = 0; i < requests.length; i += 20) {
    const chunk = requests.slice(i, i + 20).map((r) => {
      let headers: Record<string, string> = { ...(r.headers ?? {}) };
      if (r.body !== undefined) headers = { "Content-Type": "application/json", ...headers };
      if (wantsImmutableIds(r.url)) headers = withImmutablePrefer(headers);
      return { ...r, url: r.url.replace(GRAPH, ""), headers: Object.keys(headers).length ? headers : undefined };
    });
    const res = await graphFetch<{ responses: BatchResponse[] }>(instance, scopes, "/$batch", { method: "POST", body: { requests: chunk }, immutableIds: false });
    out.push(...res.responses);
  }
  return out;
}
