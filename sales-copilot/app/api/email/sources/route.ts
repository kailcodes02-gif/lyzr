import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/google/oauth";
import { searchMessages } from "@/lib/google/gmail";
import { getHubSpotActivity } from "@/lib/hubspot/activity";
import { TOFU_QUERY, MEETING_TRANSCRIPT_QUERY, threadQuery } from "@/lib/gmail/queries";
import type { FunnelTier, GenerationMode } from "@/lib/gmail/queries";
import { withErrorHandling } from "@/lib/api/with-error-handling";

interface RequestBody {
  tier: FunnelTier;
  mode: GenerationMode;
  contactEmail?: string;
}

const MAX_PER_CATEGORY = 20;

// Lists raw candidate sources instead of auto-summarizing them — the rep
// picks which product-update emails, meeting transcripts, thread messages,
// and knowledge-base entries actually go into the generated email, rather
// than the app silently deciding for them.
export const POST = withErrorHandling(async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tier, mode, contactEmail } = (await request.json()) as RequestBody;

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

  const [productUpdates, meetingTranscripts, thread] = await Promise.all([
    searchMessages(accessToken, TOFU_QUERY, MAX_PER_CATEGORY),
    tier === "mofu" || tier === "bofu"
      ? searchMessages(accessToken, MEETING_TRANSCRIPT_QUERY, MAX_PER_CATEGORY)
      : Promise.resolve([]),
    mode === "thread" && contactEmail
      ? searchMessages(accessToken, threadQuery(contactEmail), MAX_PER_CATEGORY)
      : Promise.resolve([]),
  ]);

  let hubspot: { found: boolean; error?: string } | null = null;
  if (tier === "bofu" && contactEmail) {
    try {
      const result = await getHubSpotActivity(contactEmail);
      hubspot = result.found
        ? { found: true }
        : { found: false, error: "No HubSpot record found for this contact." };
    } catch (err) {
      hubspot = {
        found: false,
        error: err instanceof Error ? err.message : "HubSpot lookup failed.",
      };
    }
  }

  const { data: kbEntries } = await supabase
    .from("kb_entries")
    .select("id, title, content_md")
    .order("created_at", { ascending: false })
    .limit(30);

  return NextResponse.json({
    productUpdates,
    meetingTranscripts,
    thread,
    hubspot,
    kbEntries: (kbEntries ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      preview: e.content_md.slice(0, 200),
    })),
  });
});
