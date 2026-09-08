import type { SupabaseClient } from "@supabase/supabase-js";

export type KnowledgeMatch = {
  id: string;
  sourceType: string;
  sourceRef: string;
  title: string | null;
  summary: string | null;
  excerpt: string;
  publishedAt: string | null;
};

const MAX_MATCHES = 8;
const EXCERPT_CHARS = 700;

// Pulls the passage around the first keyword hit so the user (and the
// drafting model) sees the relevant part of a long document, not its head.
function excerptAround(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, (at < 0 ? 0 : at) - Math.floor(EXCERPT_CHARS / 3));
  const slice = text.slice(start, start + EXCERPT_CHARS).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + slice + (start + EXCERPT_CHARS < text.length ? "…" : "");
}

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 8);
}

type Row = { id: string; source_type: string; source_ref: string; title: string | null; summary: string | null; content_md: string | null; published_at: string | null; fetched_at: string };

// Search every knowledge store (lyzr.ai, Slack, Drive, OneDrive, internal
// email) for what the user typed. Postgres full-text (websearch syntax) on
// the body and title first; if that finds nothing, a looser keyword
// ILIKE pass so a single unusual word still returns something.
// Relevance score for the fallback path (no search_knowledge() RPC yet):
// title hits count most, then hit density in the body, so a giant
// spreadsheet that merely contains the words once doesn't outrank a short
// note that is actually about them.
function scoreRow(r: Row, kws: string[]): number {
  const title = (r.title ?? "").toLowerCase();
  const body = (r.content_md ?? r.summary ?? "").toLowerCase();
  let score = 0;
  for (const t of kws) {
    if (title.includes(t)) score += 5;
    let idx = 0;
    let hits = 0;
    while ((idx = body.indexOf(t, idx)) >= 0 && hits < 50) {
      hits++;
      idx += t.length;
    }
    score += Math.min(hits, 20) / Math.max(1, body.length / 2000);
  }
  return score;
}

// Search every knowledge store (lyzr.ai, Slack, Drive, OneDrive, internal
// email, meeting notes) for what the user typed. Uses the ranked
// search_knowledge() function when migration 012 is applied; otherwise
// PostgREST full-text on body/title re-ranked client-side, then a loose
// keyword ILIKE pass so a single unusual word still returns something.
export async function searchKnowledge(db: SupabaseClient, query: string, limit = MAX_MATCHES): Promise<KnowledgeMatch[]> {
  const q = query.trim();
  if (!q) return [];
  const kws = terms(q);
  const toMatch = (r: Row): KnowledgeMatch => ({
    id: r.id,
    sourceType: r.source_type,
    sourceRef: r.source_ref,
    title: r.title,
    summary: r.summary,
    excerpt: excerptAround(r.content_md ?? r.summary ?? "", kws),
    publishedAt: r.published_at,
  });

  const ranked = await db.rpc("search_knowledge", { q, n: limit });
  if (!ranked.error && Array.isArray(ranked.data)) {
    return (ranked.data as Row[]).map(toMatch);
  }

  const select = "id, source_type, source_ref, title, summary, content_md, published_at, fetched_at";
  const seen = new Map<string, Row>();
  const add = (rows: Row[] | null) => {
    for (const r of rows ?? []) if (!seen.has(r.id)) seen.set(r.id, r);
  };

  const [byBody, byTitle] = await Promise.all([
    db.from("knowledge_documents").select(select).textSearch("content_md", q, { type: "websearch" }).limit(limit * 4),
    db.from("knowledge_documents").select(select).textSearch("title", q, { type: "websearch" }).limit(limit * 2),
  ]);
  add(byTitle.data as Row[] | null);
  add(byBody.data as Row[] | null);

  if (seen.size === 0 && kws.length > 0) {
    const orFilter = kws.flatMap((t) => [`title.ilike.%${t}%`, `content_md.ilike.%${t}%`]).join(",");
    const loose = await db.from("knowledge_documents").select(select).or(orFilter).order("published_at", { ascending: false, nullsFirst: false }).limit(limit * 3);
    add(loose.data as Row[] | null);
  }

  return Array.from(seen.values())
    .map((r) => ({ r, score: scoreRow(r, kws) }))
    .sort((a, b) => b.score - a.score || (b.r.published_at ?? b.r.fetched_at).localeCompare(a.r.published_at ?? a.r.fetched_at))
    .slice(0, limit)
    .map(({ r }) => toMatch(r));
}

// Reference material for drafting: the documents behind whatever the user
// selected (suggested topics carry a source_ref; searched items carry an id).
export async function fetchReferenceDocs(db: SupabaseClient, input: { ids: string[]; sourceRefs: string[] }, query: string | null): Promise<KnowledgeMatch[]> {
  const out = new Map<string, KnowledgeMatch>();
  const select = "id, source_type, source_ref, title, summary, content_md, published_at, fetched_at";
  const kws = query ? terms(query) : [];
  const toMatch = (r: Row): KnowledgeMatch => ({
    id: r.id,
    sourceType: r.source_type,
    sourceRef: r.source_ref,
    title: r.title,
    summary: r.summary,
    excerpt: excerptAround(r.content_md ?? r.summary ?? "", kws.length ? kws : [r.title ?? ""]),
    publishedAt: r.published_at,
  });
  if (input.ids.length > 0) {
    const { data } = await db.from("knowledge_documents").select(select).in("id", input.ids.slice(0, 12));
    for (const r of (data ?? []) as Row[]) out.set(r.id, toMatch(r));
  }
  if (input.sourceRefs.length > 0) {
    const { data } = await db.from("knowledge_documents").select(select).in("source_ref", input.sourceRefs.slice(0, 12));
    for (const r of (data ?? []) as Row[]) if (!out.has(r.id)) out.set(r.id, toMatch(r));
  }
  return Array.from(out.values()).slice(0, 12);
}
