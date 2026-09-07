import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractDocumentToMarkdown } from "@/lib/ai/claude";
import { withErrorHandling } from "@/lib/api/with-error-handling";

interface RequestBody {
  fileName: string;
  base64Data: string;
  mimeType: string;
  scope: "global" | "private";
}

// Accepts a PDF or image, has Claude convert it to markdown, and stores the
// result in the knowledge base — the "anything uploaded is read and made
// into markdown" step from the spec.
export const POST = withErrorHandling(async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { fileName, base64Data, mimeType, scope } = (await request.json()) as RequestBody;
  if (!fileName || !base64Data || !mimeType) {
    return NextResponse.json({ error: "fileName, base64Data, and mimeType are required" }, { status: 400 });
  }

  const contentMd = await extractDocumentToMarkdown({ base64Data, mimeType });

  const { data, error } = await supabase
    .from("kb_entries")
    .insert({
      uploaded_by: user.id,
      title: fileName,
      content_md: contentMd,
      source_type: "upload",
      scope: scope === "private" ? "private" : "global",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id, contentMd });
});
