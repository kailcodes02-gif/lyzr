"use client";

// Mock mode: real Microsoft sign-in, fake Graph data. Lets every page be
// exercised before the tenant admin approves the data permissions.
// Turn on with ?mock=1 on any URL (persists in localStorage), off with ?mock=0.
import { handleCalendar } from "./calendar";
import { handleDrive } from "./drive";
import { handleMail } from "./mail";

const KEY = "msui.mock";

// Pure enough to call during render: ?mock=1 turns the flag on (idempotent),
// but ?mock=0 is only honoured by syncMockFromUrl() (called from effects),
// because a stale URL during a client-side transition must never clear it.
export function isMockMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("mock");
    if (q === "1") localStorage.setItem(KEY, "1");
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function syncMockFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const q = new URLSearchParams(window.location.search).get("mock");
    if (q === "0") localStorage.removeItem(KEY);
    if (q === "1") localStorage.setItem(KEY, "1");
  } catch {
    // storage blocked
  }
}

export function setMockMode(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked
  }
}

export type MockHandler = (method: string, url: URL, body: unknown) => unknown | undefined;

export class MockNotFound extends Error {}

const ME = {
  displayName: "Kailash G M",
  mail: "kailash.gm@lyzr.com",
  userPrincipalName: "kailash.gm@lyzr.com",
  jobTitle: "Marketing",
  id: "mock-user-1",
};

const MOCK_CONTACTS = [
  { id: "c1", displayName: "Siva Surendira", emailAddresses: [{ name: "Siva Surendira", address: "siva@lyzr.ai" }] },
  { id: "c2", displayName: "Anirudh Narayan", emailAddresses: [{ name: "Anirudh Narayan", address: "anirudh@lyzr.ai" }] },
  { id: "c3", displayName: "Priya Raman", emailAddresses: [{ name: "Priya Raman", address: "priya.raman@accenture.com" }] },
  { id: "c4", displayName: "Daniel Okafor", emailAddresses: [{ name: "Daniel Okafor", address: "daniel.okafor@infosys.com" }] },
  { id: "c5", displayName: "Mei Chen", emailAddresses: [{ name: "Mei Chen", address: "mei.chen@wipro.com" }] },
  { id: "c6", displayName: "Rahul Verma", emailAddresses: [{ name: "Rahul Verma", address: "rahul.verma@tcs.com" }] },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Entry point used by graphFetch. Returns parsed JSON-like data.
export async function mockGraph(path: string, method: string, body: unknown): Promise<unknown> {
  await sleep(120);
  const url = new URL(path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`);
  const p = url.pathname.replace(/^\/v1\.0/, "");
  if (p === "/$batch" && method === "POST") {
    const reqs = ((body as { requests?: { id: string; method: string; url: string; body?: unknown }[] })?.requests ?? []);
    const responses = [];
    for (const r of reqs) {
      try {
        const data = await mockGraph(r.url, r.method, r.body);
        responses.push({ id: r.id, status: data === undefined ? 204 : 200, body: data });
      } catch (e) {
        responses.push({ id: r.id, status: 404, body: { error: { code: "NotFound", message: String(e) } } });
      }
    }
    return { responses };
  }
  if (p === "/me") return ME;
  if (p === "/me/contacts") return { value: MOCK_CONTACTS };
  const handlers: MockHandler[] = [handleMail, handleDrive, handleCalendar];
  for (const h of handlers) {
    const r = h(method, url, body);
    if (r !== undefined) return r;
  }
  throw new MockNotFound(`mock: no handler for ${method} ${p}`);
}
