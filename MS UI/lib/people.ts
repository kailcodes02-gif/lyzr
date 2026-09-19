"use client";

import { useMsal } from "@azure/msal-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { graphGetAll } from "./graph";

export type Person = { name: string; email: string; source: "contact" | "recent" };

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

// Contacts.Read only (People.Read is admin-blocked): the user's own contact
// list plus people they recently addressed from this app.
export function usePeople() {
  const { instance, accounts } = useMsal();
  const q = useQuery({
    queryKey: ["contacts", accounts[0]?.homeAccountId],
    enabled: accounts.length > 0 || typeof window !== "undefined",
    staleTime: 10 * 60_000,
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
  const people = useMemo(() => {
    const seen = new Set<string>();
    const all: Person[] = [];
    for (const p of [...recentPeople(), ...(q.data ?? [])]) {
      const k = p.email.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(p);
    }
    return all;
  }, [q.data]);
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
