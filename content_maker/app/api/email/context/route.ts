import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/google/oauth";
import { searchMessages } from "@/lib/google/gmail";
import { buildGmailQuery, type FunnelTier, type GenerationMode } from "@/lib/gmail/queries";
import { getHubSpotActivity } from "@/lib/hubspot/activity";
import { summarizeEmailContext } from "@/lib/ai/claude";
import { withErrorHandling } from "@/lib/api/with-error-handling";

interface RequestBody {
  tier: FunnelTier;
  mode: GenerationMode;
  contactEmail?: string;
  extraContext?: string;
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as RequestBody;
  const { tier, mode, contactEmail, extraContext } = body;

  if (mode === "thread" && !contactEmail) {
    return NextResponse.json(
      { error: "contactEmail is required for thread mode" },
      { status: 400 }
    );
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(user.id);
  } catch {
    return NextResponse.json(
      { error: "Gmail isn't connected for this account — please sign out and sign back in." },
      { status: 409 }
    );
  }

  const query = buildGmailQuery(tier, mode, contactEmail);
  const messages = await searchMessages(accessToken, query);

  // BOFU degrades gracefully to MOFU-level context if HubSpot isn't
  // configured yet, or the contact simply isn't in HubSpot — never a hard
  // error, since the email is still generatable without it.
  let hubspotActivity: unknown | undefined;
  let hubspotError: string | undefined;
  if (tier === "bofu" && contactEmail) {
    try {
      const result = await getHubSpotActivity(contactEmail);
      if (result.found) hubspotActivity = result.raw;
      else hubspotError = "No HubSpot record found for this contact.";
    } catch (err) {
      hubspotError = err instanceof Error ? err.message : "HubSpot lookup failed.";
      console.warn("HubSpot activity lookup failed, continuing without it:", err);
    }
  }

  const { data: kbEntries } = await supabase
    .from("kb_entries")
    .select("title, content_md")
    .order("created_at", { ascending: false })
    .limit(20);
  const kbSnippets = (kbEntries ?? []).map((e) => `${e.title}\n${e.content_md}`);

  const context = await summarizeEmailContext({
    tier,
    messages,
    hubspotActivity,
    kbSnippets,
    extraContext,
  });

  return NextResponse.json({
    context,
    sourcesUsed: {
      gmailMessageCount: messages.length,
      hubspotActivityFound: hubspotActivity !== undefined,
      hubspotError,
      kbEntryCount: kbSnippets.length,
    },
  });
});
