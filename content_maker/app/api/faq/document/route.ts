import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateDocument } from "@/lib/ai/claude";
import { withErrorHandling } from "@/lib/api/with-error-handling";

interface RequestBody {
  request: string;
}

// Document/PDF/one-pager generation is Claude's job per the spec (Gemini
// only does plain Q&A). Produces self-contained HTML — see the note in
// lib/ai/claude.ts on why this isn't a binary PDF.
export const POST = withErrorHandling(async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { request: docRequest } = (await request.json()) as RequestBody;
  if (!docRequest?.trim()) {
    return NextResponse.json({ error: "request is required" }, { status: 400 });
  }

  const { data: kbEntries } = await supabase
    .from("kb_entries")
    .select("title, content_md")
    .order("created_at", { ascending: false })
    .limit(30);
  const kbSnippets = (kbEntries ?? []).map((e) => `${e.title}\n${e.content_md}`);

  const doc = await generateDocument({ request: docRequest, kbSnippets });
  return NextResponse.json(doc);
});
