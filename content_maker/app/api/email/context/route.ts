import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHubSpotActivity } from "@/lib/hubspot/activity";
import { summarizeEmailContext } from "@/lib/ai/claude";
import type { FunnelTier } from "@/lib/gmail/queries";
import type { GmailMessageSummary } from "@/lib/google/gmail";
import { withErrorHandling } from "@/lib/api/with-error-handling";

interface RequestBody {
  tier: FunnelTier;
  selectedMessages: GmailMessageSummary[];
  includeHubspot?: boolean;
  hubspotContactEmail?: string;
  selectedKbEntryIds: string[];
  extraContext?: string;
}

// Summarizes exactly the sources the rep picked in /api/email/sources —
// never re-searches Gmail itself, so what gets summarized is exactly what
// was shown and checked, nothing silently pulled in behind the scenes.
export const POST = withErrorHandling(async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as RequestBody;
  const {
    tier,
    selectedMessages,
    includeHubspot,
    hubspotContactEmail,
    selectedKbEntryIds,
    extraContext,
  } = body;

  // BOFU degrades gracefully to MOFU-level context if HubSpot isn't
  // configured yet, or the contact simply isn't in HubSpot — never a hard
  // error, since the email is still generatable without it.
  let hubspotActivity: unknown | undefined;
  let hubspotError: string | undefined;
  if (includeHubspot && hubspotContactEmail) {
    try {
      const result = await getHubSpotActivity(hubspotContactEmail);
      if (result.found) hubspotActivity = result.raw;
      else hubspotError = "No HubSpot record found for this contact.";
    } catch (err) {
      hubspotError = err instanceof Error ? err.message : "HubSpot lookup failed.";
      console.warn("HubSpot activity lookup failed, continuing without it:", err);
    }
  }

  let kbSnippets: string[] = [];
  if (selectedKbEntryIds.length) {
    const { data: kbEntries } = await supabase
      .from("kb_entries")
      .select("title, content_md")
      .in("id", selectedKbEntryIds);
    kbSnippets = (kbEntries ?? []).map((e) => `${e.title}\n${e.content_md}`);
  }

  const context = await summarizeEmailContext({
    tier,
    messages: selectedMessages,
    hubspotActivity,
    kbSnippets,
    extraContext,
  });

  return NextResponse.json({
    context,
    sourcesUsed: {
      gmailMessageCount: selectedMessages.length,
      hubspotActivityFound: hubspotActivity !== undefined,
      hubspotError,
      kbEntryCount: kbSnippets.length,
    },
  });
});
