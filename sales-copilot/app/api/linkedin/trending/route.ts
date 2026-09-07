import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { suggestTrendingTopic } from "@/lib/ai/claude";
import { withErrorHandling } from "@/lib/api/with-error-handling";

export const GET = withErrorHandling(async (_request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: kbEntries } = await supabase
    .from("kb_entries")
    .select("title, content_md")
    .order("created_at", { ascending: false })
    .limit(15);
  const kbSnippets = (kbEntries ?? []).map((e) => `${e.title}\n${e.content_md}`);

  const topic = await suggestTrendingTopic(kbSnippets);
  return NextResponse.json({ topic });
});
