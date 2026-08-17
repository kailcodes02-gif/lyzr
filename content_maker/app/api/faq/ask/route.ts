import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { answerFromKnowledgeBase } from "@/lib/ai/claude";
import { withErrorHandling } from "@/lib/api/with-error-handling";

interface RequestBody {
  question: string;
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { question } = (await request.json()) as RequestBody;
  if (!question?.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const { data: kbEntries } = await supabase
    .from("kb_entries")
    .select("title, content_md")
    .order("created_at", { ascending: false })
    .limit(30);
  const kbSnippets = (kbEntries ?? []).map((e) => `${e.title}\n${e.content_md}`);

  const result = await answerFromKnowledgeBase({ question, kbSnippets });
  return NextResponse.json(result);
});
