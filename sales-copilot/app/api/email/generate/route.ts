import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateEmail, type EmailContext } from "@/lib/ai/claude";
import type { FunnelTier, GenerationMode } from "@/lib/gmail/queries";
import { withErrorHandling } from "@/lib/api/with-error-handling";

interface RequestBody {
  tier: FunnelTier;
  mode: GenerationMode;
  contactEmail?: string;
  context: EmailContext;
  toneOverride?: string;
}

// Takes the context already assembled by /api/email/context and generates
// the draft via Claude. Kept separate from context assembly so a rep can
// regenerate wording without re-pulling Gmail/HubSpot each time.
export const POST = withErrorHandling(async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as RequestBody;
  const { tier, mode, contactEmail, context, toneOverride } = body;

  const email = await generateEmail({ tier, mode, context, contactEmail, toneOverride });

  const { data: draft, error } = await supabase
    .from("email_drafts")
    .insert({
      user_id: user.id,
      funnel_tier: tier,
      mode,
      contact_email: contactEmail ?? null,
      subject: email.subject,
      body_md: email.body,
      status: "generated",
    })
    .select("id, subject, body_md")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ draft });
});
