import Anthropic from "@anthropic-ai/sdk";
import type { GmailMessageSummary } from "@/lib/google/gmail";
import type { FunnelTier, GenerationMode } from "@/lib/gmail/queries";
import { buildEmailSystemPrompt } from "@/lib/prompts/email-tones";

// Everything in this app runs on Claude — the only exception would have been
// image generation, which Anthropic doesn't offer at all, and which was
// removed from the product rather than kept on a second provider. No more
// Gemini anywhere: this used to be split (Gemini read/summarized, Claude
// wrote), but Gemini's per-user OAuth path never worked and its shared-key
// fallback added a second point of failure for no real benefit once image
// generation was cut. The Anthropic SDK's built-in retry (429/5xx) covers
// what a hand-rolled retry wrapper did for the old Gemini client.
const MODEL = "claude-opus-5";

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey });
}

async function messageCreate(params: {
  system: string;
  content: Anthropic.MessageParam["content"];
  schema?: Record<string, unknown>;
  maxTokens?: number;
}): Promise<string> {
  const { system, content, schema, maxTokens = 2048 } = params;
  const response = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: {
      effort: "medium",
      ...(schema ? { format: { type: "json_schema", schema } } : {}),
    },
    system,
    messages: [{ role: "user", content }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content");
  }
  return textBlock.text;
}

async function generateJson<T>(params: {
  system: string;
  input: unknown;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const { system, input, schema, maxTokens } = params;
  const text = await messageCreate({
    system,
    content: typeof input === "string" ? input : JSON.stringify(input),
    schema,
    maxTokens,
  });
  return JSON.parse(text) as T;
}

// ── Email context summarization (was Gemini) ────────────────────────────

export interface EmailContext {
  productUpdates: string[];
  companyWins: string[];
  threadSummary: string | null;
  dealSignals: string[];
}

const CONTEXT_SCHEMA = {
  type: "object",
  properties: {
    productUpdates: { type: "array", items: { type: "string" } },
    companyWins: { type: "array", items: { type: "string" } },
    threadSummary: { anyOf: [{ type: "string" }, { type: "null" }] },
    dealSignals: { type: "array", items: { type: "string" } },
  },
  required: ["productUpdates", "companyWins", "threadSummary", "dealSignals"],
  additionalProperties: false,
};

// The "read + trace" step: reduces raw Gmail messages, optional HubSpot
// engagement data, and knowledge-base snippets into a compact, structured
// brief. generateEmail writes from this, never from the raw sources
// directly — keeps that prompt small and on-topic.
export async function summarizeEmailContext(params: {
  tier: FunnelTier;
  messages: GmailMessageSummary[];
  hubspotActivity?: unknown;
  kbSnippets: string[];
  extraContext?: string;
}): Promise<EmailContext> {
  const { tier, messages, hubspotActivity, kbSnippets, extraContext } = params;

  const sourceText = [
    `Gmail messages (${messages.length}):`,
    ...messages.map(
      (m) => `- From: ${m.from} | Subject: ${m.subject} | Date: ${m.date}\n  ${m.bodyText.slice(0, 1500)}`
    ),
    hubspotActivity ? `\nHubSpot activity (raw):\n${JSON.stringify(hubspotActivity).slice(0, 6000)}` : "",
    kbSnippets.length ? `\nKnowledge base snippets:\n${kbSnippets.join("\n---\n")}` : "",
    extraContext ? `\nUser-provided context:\n${extraContext}` : "",
  ].join("\n");

  const system =
    tier === "bofu"
      ? "You extract and structure sales context for a BOFU (bottom-of-funnel) email. Emphasize deal activity, engagement recency, and any signal that supports gentle urgency (FOMO). Be factual — never invent activity that isn't in the sources."
      : "You extract and structure sales context for a sales email. Summarize only what's actually in the sources — never invent product updates, wins, or thread history that aren't present.";

  return generateJson<EmailContext>({
    system,
    input: sourceText || "No sources were found. Return empty arrays and a null threadSummary.",
    schema: CONTEXT_SCHEMA,
  });
}

// ── Email generation ──────────────────────────────────────────────────

export interface GeneratedEmail {
  subject: string;
  body: string;
}

const EMAIL_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
  required: ["subject", "body"],
  additionalProperties: false,
};

export async function generateEmail(params: {
  tier: FunnelTier;
  mode: GenerationMode;
  context: EmailContext;
  contactEmail?: string;
  toneOverride?: string;
}): Promise<GeneratedEmail> {
  const { tier, mode, context, contactEmail, toneOverride } = params;

  return generateJson<GeneratedEmail>({
    system: buildEmailSystemPrompt(tier, mode, toneOverride),
    input: {
      contactEmail: contactEmail ?? null,
      productUpdates: context.productUpdates,
      companyWins: context.companyWins,
      threadSummary: context.threadSummary,
      dealSignals: tier === "bofu" ? context.dealSignals : undefined,
    },
    schema: EMAIL_SCHEMA,
  });
}

// ── Knowledge base document extraction (was Gemini) ─────────────────────

const PDF_MEDIA_TYPE = "application/pdf" as const;
const IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

// Converts an uploaded PDF/image into clean markdown via Claude's native
// document/image input, per the spec: "anything uploaded is read and made
// into markdown, stored in the global knowledge base." HEIC/HEIF (which the
// old Gemini path accepted) aren't supported here — Claude's image input is
// jpeg/png/gif/webp only.
export async function extractDocumentToMarkdown(params: {
  base64Data: string;
  mimeType: string;
}): Promise<string> {
  const { base64Data, mimeType } = params;

  const system =
    "You convert uploaded documents/images into clean, well-structured markdown for a company knowledge base. Preserve all factual content, headings, and lists. Do not summarize or omit information — transcribe and structure it. If the file is an image with no readable text, describe what it shows factually and concisely.";

  let fileBlock: Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam;
  if (mimeType === PDF_MEDIA_TYPE) {
    fileBlock = {
      type: "document",
      source: { type: "base64", media_type: PDF_MEDIA_TYPE, data: base64Data },
    };
  } else if (IMAGE_MEDIA_TYPES.has(mimeType)) {
    fileBlock = {
      type: "image",
      source: { type: "base64", media_type: mimeType as ImageMediaType, data: base64Data },
    };
  } else {
    throw new Error(
      `Unsupported file type for knowledge upload: ${mimeType}. Supported: PDF, JPEG, PNG, GIF, WEBP.`
    );
  }

  return messageCreate({
    system,
    content: [fileBlock, { type: "text", text: "Convert this into markdown for our knowledge base." }],
    maxTokens: 4096,
  });
}

// ── FAQ (strictly from knowledge base, was Gemini) ──────────────────────

export interface FaqAnswer {
  hasEnoughInfo: boolean;
  answer: string;
}

const FAQ_SCHEMA = {
  type: "object",
  properties: {
    hasEnoughInfo: { type: "boolean" },
    answer: { type: "string" },
  },
  required: ["hasEnoughInfo", "answer"],
  additionalProperties: false,
};

// Answers strictly from the provided knowledge base snippets — never from
// general knowledge. Says so plainly (hasEnoughInfo: false) when the KB
// doesn't cover the question, per spec.
export async function answerFromKnowledgeBase(params: {
  question: string;
  kbSnippets: string[];
}): Promise<FaqAnswer> {
  const { question, kbSnippets } = params;

  const system = `You answer questions using ONLY the knowledge base content provided below — never your own general knowledge. If the knowledge base doesn't contain enough information to answer, set hasEnoughInfo to false and say so plainly in "answer" rather than guessing or filling gaps from outside knowledge.

Knowledge base:
${kbSnippets.length ? kbSnippets.join("\n---\n") : "(empty — no entries yet)"}`;

  return generateJson<FaqAnswer>({ system, input: question, schema: FAQ_SCHEMA });
}

// ── LinkedIn ──────────────────────────────────────────────────────────

export interface GeneratedLinkedInPost {
  content: string;
}

const LINKEDIN_SCHEMA = {
  type: "object",
  properties: {
    content: { type: "string" },
  },
  required: ["content"],
  additionalProperties: false,
};

export async function generateLinkedInPost(params: {
  topic: string;
  voiceSamples: string[];
  inspirationPost?: string;
  sourceText?: string;
  toneOverride?: string;
}): Promise<GeneratedLinkedInPost> {
  const { topic, voiceSamples, inspirationPost, sourceText, toneOverride } = params;

  const system = `You write LinkedIn thought-leadership posts on behalf of a Lyzr sales/partnerships rep. The post must be topic-oriented and written in the rep's own voice.

${
  voiceSamples.length
    ? `The rep's voice — match this tone, sentence rhythm, and structure closely. These are their own past posts:\n${voiceSamples
        .map((s, i) => `--- Sample ${i + 1} ---\n${s}`)
        .join("\n")}`
    : "No voice samples provided yet — write in a natural, confident, non-corporate thought-leadership voice."
}
${inspirationPost ? `\nThe rep also flagged this post as inspiration for structure/angle (don't copy it, just take inspiration):\n${inspirationPost}` : ""}
${sourceText ? `\nRelevant source context to ground the post in (product updates, wins, or conversations):\n${sourceText}` : ""}
${toneOverride ? `\nAdditional tone/style adjustment requested: ${toneOverride}` : ""}

Write a complete, ready-to-post LinkedIn post. No hashtag spam (0-3 relevant hashtags max), no emoji stacking, no "Thoughts?" filler endings unless it fits the rep's own voice samples.`;

  return generateJson<GeneratedLinkedInPost>({ system, input: `Topic: ${topic}`, schema: LINKEDIN_SCHEMA });
}

// ── LinkedIn trending topic suggestion (was Gemini) ──────────────────────

export async function suggestTrendingTopic(kbSnippets: string[]): Promise<string> {
  const system =
    "You suggest one trending, timely topic in the AI/enterprise-software space that would make a good LinkedIn thought-leadership post, informed by the company's own knowledge base context below. Respond with just the topic in one sentence, nothing else — no preamble, no quotes.";
  const input = kbSnippets.length
    ? `Company context:\n${kbSnippets.join("\n---\n")}`
    : "No company context available — suggest a generally relevant, current AI industry topic.";
  return messageCreate({ system, content: input, maxTokens: 256 });
}

// ── FAQ document generation ──────────────────────────────────────────

export interface GeneratedDocument {
  title: string;
  html: string;
}

const DOCUMENT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    html: {
      type: "string",
      description: "A complete, self-contained HTML document (with inline styling) presenting the requested content.",
    },
  },
  required: ["title", "html"],
  additionalProperties: false,
};

// For FAQ requests that ask for a document/PDF/one-pager rather than a plain
// answer. Produces a self-contained HTML file (downloadable, printable to
// PDF by the rep) rather than a binary PDF — avoids taking on a PDF-generation
// dependency of unconfirmed Workers-runtime compatibility.
export async function generateDocument(params: {
  request: string;
  kbSnippets: string[];
}): Promise<GeneratedDocument> {
  const { request, kbSnippets } = params;

  const system = `You create a clean, well-formatted, self-contained HTML document based strictly on the company knowledge base provided below — never invent facts not present in it. Use inline CSS (no external stylesheets/fonts/scripts), sensible typography, and headings. This will be downloaded and possibly printed, so keep it presentable as a one-pager or short document.

Knowledge base:
${kbSnippets.length ? kbSnippets.join("\n---\n") : "(empty — no entries yet; note this limitation in the document itself)"}`;

  return generateJson<GeneratedDocument>({ system, input: request, schema: DOCUMENT_SCHEMA, maxTokens: 4096 });
}
