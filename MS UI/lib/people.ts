"use client";

import { useMsal } from "@azure/msal-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { graphFetch, graphGetAll, ConsentRequiredError, GraphError } from "./graph";
import { isMockMode } from "./mock";

export type PersonSource = "recent" | "people" | "directory" | "contact";
export type Person = { name: string; email: string; source: PersonSource; title?: string };

type Contact = { id: string; displayName?: string; emailAddresses?: { name?: string; address?: string }[] };

const RECENT_KEY = "msui.recentPeople";

export function rememberRecipients(people: { name?: string | null; email: string }[]) {
  try {
    const cur: Person[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    const byEmail = new Map(cur.map((p) => [p.email.toLowerCase(), p]));
    for (const p of people) {
      if (!p.email) continue;
      byEmail.delete(p.email.toLowerCase());
      byEmail.set(p.email.toLowerCase(), { name: p.name ?? p.email, email: p.email, source: "recent" });
    }
    localStorage.setItem(RECENT_KEY, JSON.stringify(Array.from(byEmail.values()).slice(-200)));
  } catch {
    // storage blocked
  }
}

function recentPeople(): Person[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Person[]).reverse();
  } catch {
    return [];
  }
}

// Contacts.Read: the user's own contact list plus people they recently
// addressed from this app. Kept as the always-available base list.
export function usePeople() {
  const { instance, accounts } = useMsal();
  const q = useQuery({
    queryKey: ["contacts", accounts[0]?.homeAccountId],
    enabled: accounts.length > 0 || typeof window !== "undefined",
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      const contacts = await graphGetAll<Contact>(instance, ["Contacts.Read"], "/me/contacts?$select=id,displayName,emailAddresses&$top=500", 2000, { immutableIds: false });
      const out: Person[] = [];
      for (const c of contacts) {
        for (const e of c.emailAddresses ?? []) {
          if (e.address) out.push({ name: c.displayName ?? e.name ?? e.address, email: e.address, source: "contact" });
        }
      }
      return out;
    },
  });
  const people = useMemo(() => mergePeople([recentPeople(), q.data ?? []]), [q.data]);
  return { people, isLoading: q.isPending, error: q.error };
}

export function searchPeople(people: Person[], query: string, limit = 8): Person[] {
  const q = query.trim().toLowerCase();
  if (!q) return people.slice(0, limit);
  const starts = people.filter((p) => p.name.toLowerCase().startsWith(q) || p.email.toLowerCase().startsWith(q));
  const contains = people.filter((p) => !starts.includes(p) && (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)));
  return [...starts, ...contains].slice(0, limit);
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- directory-backed suggestions ----------

// Sources in rank order; later sources fill in a job title the earlier one lacked.
const SOURCE_RANK: Record<PersonSource, number> = { recent: 0, people: 1, directory: 2, contact: 3 };

// Merge lists (already in rank order), de-duplicated by email, stable within a source.
export function mergePeople(lists: Person[][]): Person[] {
  const byEmail = new Map<string, Person>();
  for (const list of lists) {
    for (const p of list) {
      if (!p.email) continue;
      const k = p.email.toLowerCase();
      const cur = byEmail.get(k);
      if (!cur) byEmail.set(k, { ...p });
      else {
        if (!cur.title && p.title) cur.title = p.title;
        if ((cur.name === cur.email || !cur.name) && p.name) cur.name = p.name;
      }
    }
  }
  return Array.from(byEmail.values()).sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
}

// Rank for a typed query: prefix matches on name/email first, then substring, source order as tiebreak.
export function rankPeople(people: Person[], query: string, limit = 8): Person[] {
  const q = query.trim().toLowerCase();
  if (!q) return people.slice(0, limit);
  const score = (p: Person) => {
    const n = p.name.toLowerCase();
    const e = p.email.toLowerCase();
    if (n.startsWith(q) || e.startsWith(q)) return 0;
    if (n.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    if (n.includes(q) || e.includes(q) || (p.title ?? "").toLowerCase().includes(q)) return 2;
    return 9;
  };
  return people
    .map((p, i) => ({ p, s: score(p), i }))
    .filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || SOURCE_RANK[a.p.source] - SOURCE_RANK[b.p.source] || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.p);
}

type GraphPerson = { displayName?: string; jobTitle?: string | null; userPrincipalName?: string; scoredEmailAddresses?: { address?: string; relevanceScore?: number }[]; personType?: { class?: string; subclass?: string } };
type GraphUser = { id: string; displayName?: string; mail?: string | null; userPrincipalName?: string; jobTitle?: string | null };

// A source that answered 401/403/consent-required is skipped for the rest of the session.
const deadSources = new Set<string>();
const cache = new Map<string, Person[]>();

function isAuthFailure(e: unknown) {
  return e instanceof ConsentRequiredError || (e instanceof GraphError && (e.status === 401 || e.status === 403)) || (e instanceof Error && e.name === "InteractionRequiredAuthError");
}

function quote(q: string) {
  return `"${q.replace(/["\\]/g, "")}"`;
}

type Instance = ReturnType<typeof useMsal>["instance"];

async function fetchSource(key: string, run: () => Promise<Person[]>): Promise<Person[]> {
  if (deadSources.has(key)) return [];
  try {
    return await run();
  } catch (e) {
    if (isAuthFailure(e)) deadSources.add(key);
    return [];
  }
}

// GET /me/people?$search="q" (People.Read): relevance-ranked colleagues and frequent contacts.
async function searchGraphPeople(instance: Instance, q: string): Promise<Person[]> {
  return fetchSource("people", async () => {
    // By default /me/people serves mailbox-only results; the QuerySources header adds
    // organisation-wide directory people (learn: people-insights-overview, "Types of
    // results included"), so colleagues still appear when /users (User.ReadBasic.All) is unavailable.
    const res = await graphFetch<{ value: GraphPerson[] }>(instance, ["People.Read"], `/me/people?$search=${encodeURIComponent(quote(q))}&$top=10&$select=displayName,jobTitle,userPrincipalName,scoredEmailAddresses,personType`, {
      immutableIds: false,
      headers: { "X-PeopleQuery-QuerySources": "Mailbox,Directory" },
    });
    const out: Person[] = [];
    for (const p of res.value ?? []) {
      const email = [...(p.scoredEmailAddresses ?? [])].sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))[0]?.address || p.userPrincipalName;
      if (!email) continue;
      out.push({ name: p.displayName || email, email, source: "people", title: p.jobTitle || undefined });
    }
    return out;
  });
}

// GET /users?$search="displayName:q" OR "mail:q" (User.ReadBasic.All): the whole directory.
// $search needs ConsistencyLevel: eventual and $count=true.
async function searchDirectory(instance: Instance, q: string): Promise<Person[]> {
  return fetchSource("directory", async () => {
    const search = encodeURIComponent(`${quote(`displayName:${q}`)} OR ${quote(`mail:${q}`)}`);
    const res = await graphFetch<{ value: GraphUser[] }>(instance, ["User.ReadBasic.All"], `/users?$search=${search}&$select=id,displayName,mail,userPrincipalName,jobTitle&$top=10&$count=true`, {
      immutableIds: false,
      headers: { ConsistencyLevel: "eventual" },
    });
    const out: Person[] = [];
    for (const u of res.value ?? []) {
      const email = u.mail || u.userPrincipalName;
      if (!email) continue;
      out.push({ name: u.displayName || email, email, source: "directory", title: u.jobTitle || undefined });
    }
    return out;
  });
}

export async function searchRemotePeople(instance: Instance, q: string): Promise<Person[]> {
  const key = q.trim().toLowerCase();
  if (!key) return [];
  const hit = cache.get(key);
  if (hit) return hit;
  const [people, directory] = await Promise.all([searchGraphPeople(instance, key), searchDirectory(instance, key)]);
  const merged = mergePeople([people, directory]);
  cache.set(key, merged);
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return merged;
}

// Test hook: forget remembered failures and cached answers.
export function resetPeopleSearch() {
  deadSources.clear();
  cache.clear();
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// Suggestions for a typed query: recent recipients, /me/people, /users, contacts,
// merged and de-duplicated by email. Each remote source is optional.
export function usePeopleSearch(query: string, limit = 8) {
  const { instance, accounts } = useMsal();
  const { people: base } = usePeople();
  const q = useDebounced(query.trim().toLowerCase(), 250);
  const remote = useQuery({
    queryKey: ["peopleSearch", accounts[0]?.homeAccountId, q],
    enabled: q.length > 0 && (accounts.length > 0 || isMockMode()),
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: (prev) => prev,
    queryFn: () => searchRemotePeople(instance, q),
  });
  const suggestions = useMemo(() => {
    const live = query.trim().toLowerCase();
    const remoteList = live && q === live ? (remote.data ?? []) : live && remote.data && live.startsWith(q) ? remote.data : [];
    return rankPeople(mergePeople([base.filter((p) => p.source === "recent"), remoteList, base.filter((p) => p.source !== "recent")]), live, limit);
  }, [base, remote.data, q, query, limit]);
  return { suggestions, isSearching: remote.isFetching };
}
