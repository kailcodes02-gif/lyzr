import type { SupabaseClient } from "@supabase/supabase-js";

// Full-page text extraction for scraping/summarization -- htmlToSnippet in
// lib/sync/util.ts truncates to ~400 chars for UI display, which is too
// short to summarize a whole blog post from. Same regex approach, just
// without the aggressive cap (still bounded, so one huge page can't blow up
// a single Sonnet call's input tokens).
export function htmlToText(html: string, maxLen = 6000): string {
  let text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
  };
  for (const [entity, char] of Object.entries(entities)) text = text.split(entity).join(char);
  text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  if (text.length > maxLen) text = Array.from(text).slice(0, maxLen).join("").trimEnd() + "…";
  return text;
}

export function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : null;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Storage buckets aren't created by SQL migrations -- created lazily here
// (idempotent) rather than requiring a manual dashboard step before the
// knowledge ingestion can run at all.
export async function ensureKnowledgeBucket(db: SupabaseClient): Promise<void> {
  const { error } = await db.storage.createBucket("knowledge", { public: false });
  if (error && !error.message.toLowerCase().includes("already exists")) throw error;
}

export async function writeKnowledgeMarkdown(db: SupabaseClient, fileName: string, content: string): Promise<void> {
  const { error } = await db.storage
    .from("knowledge")
    .upload(fileName, new Blob([content], { type: "text/markdown" }), { upsert: true });
  if (error) throw error;
}
