import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODEL, DEFAULT_EFFORT, getAnthropicClient } from "../ai/client";
import { ensureKnowledgeBucket, extractTitle, htmlToText, sha256Hex, writeKnowledgeMarkdown } from "./util";

const SITE_ORIGIN = "https://www.lyzr.ai";
// Bounds one ingestion run's wall-clock and Sonnet spend regardless of how
// large the site grows -- logged explicitly (never a silent truncation),
// same convention as Instantly's NO_TAG_FALLBACK_CAMPAIGN_CAP.
const MAX_PAGES_PER_RUN = 60;

type PageRef = { url: string; sourceType: "lyzr_blog" | "lyzr_case_study" };

function classify(url: string): PageRef["sourceType"] | null {
  if (/case-stud(y|ies)/i.test(url)) return "lyzr_case_study";
  if (/\/blog\//i.test(url)) return "lyzr_blog";
  return null;
}

// Sitemap first (cheap, gives every URL at once); falls back to scraping
// the index pages' own links if the sitemap path/shape doesn't match what's
// actually live on lyzr.ai. lyzr.ai's /sitemap.xml is a sitemap INDEX (it
// lists child sitemaps like blog-sitemap.xml / case-studies-sitemap.xml),
// so child sitemaps are followed one level down before URLs are classified
// -- without that, the child sitemap URLs themselves matched the
// case-study regex and got ingested as "pages" (seen 2026-09-07).
const MAX_CHILD_SITEMAPS = 25;

function extractLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)).map((m) => m[1]);
}

async function fetchSitemapUrls(url: string, log: (msg: string) => void): Promise<string[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const xml = await res.text();
    const locs = extractLocs(xml);
    if (!/<sitemapindex[\s>]/i.test(xml)) return locs;

    const children = locs.filter((l) => /\.xml(\?|$)/i.test(l)).slice(0, MAX_CHILD_SITEMAPS);
    if (locs.length > children.length) {
      log(`lyzr-scrape: sitemap index at ${url} listed ${locs.length} entries, following ${children.length} child sitemap(s)`);
    }
    const nested = await Promise.all(
      children.map(async (child) => {
        try {
          const r = await fetch(child);
          if (!r.ok) return [] as string[];
          return extractLocs(await r.text());
        } catch {
          return [] as string[];
        }
      })
    );
    return nested.flat();
  } catch {
    return [];
  }
}

async function discoverPages(log: (msg: string) => void): Promise<PageRef[]> {
  const found = new Map<string, PageRef["sourceType"]>();

  for (const url of await fetchSitemapUrls(`${SITE_ORIGIN}/sitemap.xml`, log)) {
    // Never treat a sitemap file itself as content, whatever its path says.
    if (/\.xml(\?|$)/i.test(url)) continue;
    const type = classify(url);
    if (type) found.set(url, type);
  }

  if (found.size === 0) {
    for (const [path, type] of [
      ["/blog", "lyzr_blog"],
      ["/case-studies", "lyzr_case_study"],
    ] as const) {
      try {
        const res = await fetch(`${SITE_ORIGIN}${path}`);
        if (!res.ok) continue;
        const html = await res.text();
        const hrefs = Array.from(html.matchAll(/href="([^"]+)"/g)).map((m) => m[1]);
        for (const href of hrefs) {
          const url = href.startsWith("http") ? href : `${SITE_ORIGIN}${href}`;
          if (classify(url) === type) found.set(url, type);
        }
      } catch (err) {
        log(`lyzr-scrape: failed to fetch index page ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return Array.from(found, ([url, sourceType]) => ({ url, sourceType }));
}

export async function ingestLyzrSite(
  db: SupabaseClient,
  env: { ANTHROPIC_API_KEY: string },
  log: (msg: string) => void = () => {}
): Promise<{ fetched: number; upserted: number; flaggedForReview: number }> {
  await ensureKnowledgeBucket(db);

  const allPages = await discoverPages(log);

  const existing = await db
    .from("knowledge_documents")
    .select("source_type, source_ref, content_hash")
    .in("source_type", ["lyzr_blog", "lyzr_case_study"]);
  if (existing.error) throw existing.error;
  const hashByRef = new Map((existing.data ?? []).map((r) => [`${r.source_type}:${r.source_ref}`, r.content_hash]));

  // The per-run cap applies AFTER ordering, so each run makes progress
  // through the whole site instead of re-checking the same first N URLs
  // forever: pages never ingested come first (so a fresh site backfills in
  // a few weekly runs), case studies ahead of blog posts within each group
  // (fewer, and the most useful thing to cite in a customer email), then
  // already-known pages for change detection.
  const isSeen = (p: PageRef) => hashByRef.has(`${p.sourceType}:${p.url}`);
  const rank = (p: PageRef) => (isSeen(p) ? 2 : 0) + (p.sourceType === "lyzr_case_study" ? 0 : 1);
  const ordered = [...allPages].sort((a, b) => rank(a) - rank(b));
  const pages = ordered.slice(0, MAX_PAGES_PER_RUN);
  if (allPages.length > MAX_PAGES_PER_RUN) {
    const unseen = allPages.filter((p) => !isSeen(p)).length;
    log(`lyzr-scrape: capped to ${MAX_PAGES_PER_RUN} of ${allPages.length} discovered pages this run (${unseen} not yet ingested)`);
  }

  const client = getAnthropicClient(env.ANTHROPIC_API_KEY);
  let upserted = 0;
  let summarized = 0;

  for (const page of pages) {
    let html: string;
    try {
      const res = await fetch(page.url);
      if (!res.ok) continue;
      html = await res.text();
    } catch (err) {
      log(`lyzr-scrape: failed to fetch ${page.url}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const text = htmlToText(html);
    const hash = await sha256Hex(text);
    const key = `${page.sourceType}:${page.url}`;

    // The whole point of content_hash: skip the Sonnet call entirely for
    // pages that haven't changed since last week's run.
    if (hashByRef.get(key) === hash) continue;

    const title = extractTitle(html) ?? page.url;
    let summary: string | null = null;
    try {
      const response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 256,
        output_config: { effort: DEFAULT_EFFORT },
        system: "Summarize this Lyzr.ai page in 2-3 concise sentences, for internal sales/CS reference. Plain text only.",
        messages: [{ role: "user", content: text }],
      });
      const textBlock = response.content.find((b) => b.type === "text");
      summary = textBlock && "text" in textBlock ? textBlock.text.trim() : null;
      summarized++;
    } catch (err) {
      log(`lyzr-scrape: summarization failed for ${page.url}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const { error } = await db.from("knowledge_documents").upsert(
      {
        source_type: page.sourceType,
        source_ref: page.url,
        title,
        content_md: text,
        summary,
        content_hash: hash,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "source_type,source_ref" }
    );
    if (error) throw error;
    upserted++;
  }

  log(`lyzr-scrape: ${pages.length} page(s) checked, ${upserted} updated, ${summarized} re-summarized`);

  // Rebuild the canonical MD file per source type from whatever's now in the
  // table -- cheap (one query, no Sonnet), and keeps the literal "MD file"
  // deliverable in sync even on runs where nothing changed.
  for (const sourceType of ["lyzr_blog", "lyzr_case_study"] as const) {
    const { data: docs, error } = await db
      .from("knowledge_documents")
      .select("title, source_ref, summary, fetched_at")
      .eq("source_type", sourceType)
      .order("fetched_at", { ascending: false });
    if (error) throw error;
    const fileName = sourceType === "lyzr_blog" ? "lyzr-blog.md" : "lyzr-case-studies.md";
    const body = (docs ?? [])
      .map((d) => `## ${d.title}\n${d.source_ref}\n\n${d.summary ?? "(not yet summarized)"}\n`)
      .join("\n");
    await writeKnowledgeMarkdown(db, fileName, `# ${fileName}\n\n${body}`);
  }

  return { fetched: pages.length, upserted, flaggedForReview: 0 };
}
