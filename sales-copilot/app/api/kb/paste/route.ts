import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";

interface RequestBody {
  title: string;
  content: string;
  scope: "global" | "private";
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title, content, scope } = (await request.json()) as RequestBody;
  if (!title?.trim() || !content?.trim()) {
    return NextResponse.json({ error: "title and content are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("kb_entries")
    .insert({
      uploaded_by: user.id,
      title: title.trim(),
      content_md: content.trim(),
      source_type: "paste",
      scope: scope === "private" ? "private" : "global",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
});
