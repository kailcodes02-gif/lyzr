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

export const REDIRECT_MARKER = "msui.redirect";

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
      // One redirect attempt per scope set per session: if we come back and
      // still fail, surface the error instead of looping through Entra.
      const key = `${REDIRECT_MARKER}:${scopes.slice().sort().join(" ")}`;
      let seen = false;
      try {
        seen = sessionStorage.getItem(key) === "1";
        if (seen) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, "1");
      } catch {
        // storage blocked: fall through to a single redirect
      }
      if (seen) throw e;
      await instance.acquireTokenRedirect({ scopes, account: acc, redirectStartPage: window.location.href });
      // The page is navigating away; keep callers (React Query) pending so
      // they do not treat the in-flight redirect as a failure.
      return new Promise<never>(() => {});
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

function buildHeaders(url: string, init: GraphInit, token: string): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.headers ?? {}) };
  const wantsImmutable = init.immutableIds ?? /\/me\/(messages|mailFolders)/.test(url);
  if (wantsImmutable && !/\$search=/.test(url)) {
    h.Prefer = [h.Prefer, 'IdType="ImmutableId"'].filter(Boolean).join(", ");
  }
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
// returned with their status rather than thrown.
export async function graphBatch(instance: IPublicClientApplication, scopes: string[], requests: BatchRequest[]): Promise<BatchResponse[]> {
  const out: BatchResponse[] = [];
  for (let i = 0; i < requests.length; i += 20) {
    const chunk = requests.slice(i, i + 20).map((r) => ({
      ...r,
      url: r.url.replace(GRAPH, ""),
      headers: r.body !== undefined ? { "Content-Type": "application/json", ...(r.headers ?? {}) } : r.headers,
    }));
    const res = await graphFetch<{ responses: BatchResponse[] }>(instance, scopes, "/$batch", { method: "POST", body: { requests: chunk }, immutableIds: false });
    out.push(...res.responses);
  }
  return out;
}
