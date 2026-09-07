export type FunnelTier = "tofu" | "mofu" | "bofu";
export type GenerationMode = "thread" | "general";

// Verbatim from the funnel spec: emails from meeting-notetaker bots/services,
// or subjects that look like meeting notes/summaries/transcripts.
// Exported (not just used internally) so /api/email/sources can pull this
// category on its own, separately from product updates and thread messages —
// letting the rep pick individual candidates instead of an opaque merged pull.
export const MEETING_TRANSCRIPT_QUERY =
  'from:(gemini-notes@google.com OR meet-notes-noreply@google.com OR otter.ai OR fireflies.ai OR granola.so OR fathom.video OR read.ai OR tactiq.io OR supernormal.com OR meetgeek.ai OR gong.io OR avoma.com OR tldv.io OR shadow.do OR sybil.ai OR claude.ai) OR subject:("Meeting notes" OR "Notes from" OR "Meeting summary" OR "Call transcript" OR "Meeting recording")';

// siva@/humans@ land in every rep's own inbox (no shared mailbox needed) —
// this searches the logged-in user's own Gmail.
export const TOFU_QUERY = "from:siva@lyzr.ai OR to:humans@lyzr.ai";

export function threadQuery(contactEmail: string): string {
  return `to:(${contactEmail}) OR from:(${contactEmail})`;
}

// Builds the Gmail search string for a funnel tier + mode. `contactEmail` is
// required for "thread" mode and ignored for "general" mode.
export function buildGmailQuery(
  tier: FunnelTier,
  mode: GenerationMode,
  contactEmail?: string
): string {
  const parts: string[] = [TOFU_QUERY];

  if (tier === "mofu" || tier === "bofu") {
    parts.push(MEETING_TRANSCRIPT_QUERY);
    if (mode === "thread" && contactEmail) {
      parts.push(threadQuery(contactEmail));
    }
  }

  // BOFU's extra context (HubSpot activity) isn't a Gmail query — it's
  // fetched separately via lib/hubspot/activity.ts and merged at the
  // context-assembly step in /api/email/context.
  return parts.map((p) => `(${p})`).join(" OR ");
}
