import type { TextBlock } from "@anthropic-ai/sdk/resources/messages";
import { AI_MODEL, DEFAULT_EFFORT, getAnthropicClient } from "./client";

export type DraftEmail = { subject: string; body: string };

// Selected suggestions carry their own knowledge-base context already
// (fetched once at suggestion time) -- drafting re-sends just those short
// strings rather than re-querying/re-sending the whole knowledge base,
// which is the bulk of this flow's token-efficiency story.
export async function draftEmail(
  env: { ANTHROPIC_API_KEY: string },
  input: {
    projectName: string;
    accountName: string;
    recipientName: string | null;
    selectedTopics: string[];
  }
): Promise<{ draft: DraftEmail; usage: { inputTokens: number; outputTokens: number } }> {
  const client = getAnthropicClient(env.ANTHROPIC_API_KEY);

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    output_config: { effort: DEFAULT_EFFORT },
    system:
      "You draft short, friendly customer product-update emails for a Lyzr account manager. " +
      "Reply with ONLY a JSON object (no prose, no code fence): " +
      '{"subject": "<subject line>", "body": "<plain-text email body, no HTML, no signature block>"}. ' +
      "Keep it concise (under 150 words), specific to the given topics, and end with an open invitation to reply -- not a hard call to action.",
    messages: [
      {
        role: "user",
        content:
          `Account: ${input.accountName}\nProject: ${input.projectName}\n` +
          `Recipient: ${input.recipientName ?? "the client contact"}\n\n` +
          `Topics to cover:\n${input.selectedTopics.map((t) => `- ${t}`).join("\n")}`,
      },
    ],
  });

  const textBlock = response.content.find((b): b is TextBlock => b.type === "text");
  const cleaned = (textBlock?.text ?? "{}")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  const parsed = JSON.parse(cleaned) as { subject?: string; body?: string };

  return {
    draft: { subject: parsed.subject ?? "", body: parsed.body ?? "" },
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
