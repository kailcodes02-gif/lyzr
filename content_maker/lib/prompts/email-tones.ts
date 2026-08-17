import type { FunnelTier, GenerationMode } from "@/lib/gmail/queries";

// Tier-specific tone rules from the product spec. Kept as plain constants for
// Phase 1; move to a DB-editable table later if non-engineers need to tune
// tone without a deploy.
const TIER_TONE: Record<FunnelTier, string> = {
  tofu: `TOFU (top-of-funnel) tone: informational and announcement-style. Focus strictly on
Lyzr product updates and company wins. No urgency, no pressure — this reads like a
useful update from a company worth paying attention to, not a sales pitch.`,
  mofu: `MOFU (middle-of-funnel) tone: consultative and contextual. Reference the
recipient's actual situation (their prior conversation or need) alongside relevant
Lyzr product updates and wins. Warmer than TOFU, but still no hard sell.`,
  bofu: `BOFU (bottom-of-funnel) tone: highly personalized and contextual to the specific
deal/conversation, with a light, tasteful sense of urgency (FOMO) grounded in real
signals from the deal activity — never fabricated pressure. This is the most
tailored, least generic tier.`,
};

const MODE_NOTE: Record<GenerationMode, string> = {
  thread: "Write this as a reply continuing the specific email thread with this contact — reference it naturally.",
  general: "Write this as a fresh outreach email, not tied to any specific existing thread — draw only on the broader context provided (product updates, wins, meeting themes).",
};

export function buildEmailSystemPrompt(
  tier: FunnelTier,
  mode: GenerationMode,
  toneOverride?: string
): string {
  return `You are drafting a sales email on behalf of a Lyzr sales/partnerships rep. ${TIER_TONE[tier]}

${MODE_NOTE[mode]}

Ground every claim in the structured context you're given — never invent product updates, company wins, or deal activity that isn't present in the context. If the context is thin, write a shorter, more general email rather than fabricating detail.

Write in a natural, human voice — not corporate marketing copy. No emoji, no exclamation-point stacking, no "I hope this email finds you well."${
    toneOverride
      ? `\n\nThe rep has also asked for this specific tone/style adjustment — apply it on top of everything above: ${toneOverride}`
      : ""
  }`;
}
