import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidAccessToken } from "@/lib/google/oauth";
import { createDraft } from "@/lib/google/gmail";
import { withErrorHandling } from "@/lib/api/with-error-handling";

interface RequestBody {
  draftId: string;
}

// Pushes a previously-generated email into the user's own Gmail as a draft.
// Never sends — the app has no code path that calls Gmail's drafts.send.
export const POST = withErrorHandling(async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { draftId } = (await request.json()) as RequestBody;

  const { data: draft, error } = await supabase
    .from("email_drafts")
    .select("id, subject, body_md, contact_email")
    .eq("id", draftId)
    .eq("user_id", user.id)
    .single();

  if (error || !draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const accessToken = await getValidAccessToken(user.id);
  const gmailDraftId = await createDraft(accessToken, {
    to: draft.contact_email ?? undefined,
    subject: draft.subject,
    bodyText: draft.body_md,
  });

  await supabase
    .from("email_drafts")
    .update({ gmail_draft_id: gmailDraftId, status: "saved_to_gmail" })
    .eq("id", draft.id);

  return NextResponse.json({ gmailDraftId });
});
