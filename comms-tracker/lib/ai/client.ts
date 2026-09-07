import Anthropic from "@anthropic-ai/sdk";

// Sonnet only, everywhere this app calls Claude -- explicit product
// decision, not a cost default that should silently drift to Opus later.
export const AI_MODEL = "claude-sonnet-5";

let client: Anthropic | null = null;

export function getAnthropicClient(apiKey: string): Anthropic {
  // Reused across requests within the same Worker isolate rather than
  // constructed per-call -- cheap either way, but this matches the
  // single-client convention the Supabase clients already use.
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

export type AiUsage = { inputTokens: number; outputTokens: number };

// Short-form generation (5 one-liners, one email body) never needs deep
// reasoning -- low effort keeps both latency and spend down, per the
// project's explicit low-token-consumption requirement.
export const DEFAULT_EFFORT = "low" as const;
