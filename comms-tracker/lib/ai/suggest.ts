import type { SupabaseClient } from "@supabase/supabase-js";
import type { TextBlock } from "@anthropic-ai/sdk/resources/messages";
import { AI_MODEL, DEFAULT_EFFORT, getAnthropicClient } from "./client";

export type TopicSuggestion = {
  text: string;
  sourceType: string;
  sourceRef: string | null;
};

const KNOWLEDGE_DOCS_PER_SOURCE = 5;

// Pulls a small, recency-ranked slice of the knowledge base rather than the
// whole thing -- keeps the Sonnet call's input tokens bounded regardless of
// how large the knowledge base grows, per the project's low-token-spend
// requirement.
async function fetchRecentKnowledge(db: SupabaseClient) {
  const { data, error } = await db
    .from("knowledge_documents")
    .select("source_type, source_ref, title, summary, fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(KNOWLEDGE_DOCS_PER_SOURCE * 6); // 6 source types
  if (error) throw error;

  // Cap per source_type client-side (the query above over-fetches slightly
  // to make sure every source type gets a fair shot at the recency window,
  // not just whichever source happens to sync most often).
  const bySource = new Map<string, typeof data>();
  for (const row of data ?? []) {
    const list = bySource.get(row.source_type) ?? [];
    if (list.length < KNOWLEDGE_DOCS_PER_SOURCE) {
      list.push(row);
      bySource.set(row.source_type, list);
    }
  }
  return Array.from(bySource.values()).flat();
}

function parseJsonArray(text: string): unknown[] {
  // Sonnet occasionally wraps JSON in a code fence despite instructions not
  // to -- strip it defensively rather than fail the whole request over
  // formatting.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
  return parsed;
}

export async function suggestTopics(
  db: SupabaseClient,
  env: { ANTHROPIC_API_KEY: string },
  project: { name: string; accountName: string; productEngaged: string[] }
): Promise<{ suggestions: TopicSuggestion[]; usage: { inputTokens: number; outputTokens: number } }> {
  const knowledge = await fetchRecentKnowledge(db);

  const client = getAnthropicClient(env.ANTHROPIC_API_KEY);
  const knowledgeBlock = knowledge.length
    ? knowledge
        .map((k) => `[${k.source_type}] ${k.title ?? k.source_ref} (${k.fetched_at}): ${k.summary ?? ""}`)
        .join("\n")
    : "(no knowledge base content yet)";

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    output_config: { effort: DEFAULT_EFFORT },
    system:
      "You suggest short, concrete topics for a customer product-update email. " +
      "Reply with ONLY a JSON array (no prose, no code fence) of exactly 5 objects: " +
      '{"text": "<one-line topic, <=20 words>", "sourceType": "<source type it drew from, or \\"general\\">", "sourceRef": "<source_ref if applicable, else null>"}. ' +
      "Prefer the most recent, most specific items from the knowledge base over generic filler.",
    messages: [
      {
        role: "user",
        content:
          `Project: ${project.name}\nAccount: ${project.accountName}\nProducts engaged: ${project.productEngaged.join(", ") || "unspecified"}\n\n` +
          `Recent knowledge base items (most recent first):\n${knowledgeBlock}`,
      },
    ],
  });

  const textBlock = response.content.find((b): b is TextBlock => b.type === "text");
  const raw = parseJsonArray(textBlock?.text ?? "[]");
  const suggestions: TopicSuggestion[] = raw
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .slice(0, 5)
    .map((r) => ({
      text: String(r.text ?? "").trim(),
      sourceType: String(r.sourceType ?? "general"),
      sourceRef: r.sourceRef ? String(r.sourceRef) : null,
    }))
    .filter((s) => s.text.length > 0);

  return {
    suggestions,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
