import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateLinkedInPost } from "@/lib/ai/claude";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import type { GmailMessageSummary } from "@/lib/google/gmail";

interface RequestBody {
  topic: string;
  inspirationPost?: string;
  toneOverride?: string;
  selectedMessages?: GmailMessageSummary[];
  selectedKbEntryIds?: string[];
}

// Takes the exact sources the rep checked in the "Choose your sources" step
// (found via /api/email/sources with tier=mofu, mode=general) — never
// re-searches Gmail itself, same discipline as email generation.
export const POST = withErrorHandling(async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { topic, inspirationPost, toneOverride, selectedMessages, selectedKbEntryIds } =
    (await request.json()) as RequestBody;
  if (!topic?.trim()) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const { data: sampleRows } = await supabase
    .from("linkedin_voice_samples")
    .select("content")
    .eq("user_id", user.id)
    .order("position", { ascending: true });
  const voiceSamples = (sampleRows ?? []).map((s) => s.content);

  const sourceParts: string[] = [];
  if (selectedMessages?.length) {
    sourceParts.push(
      ...selectedMessages.map((m) => `From: ${m.from} | ${m.subject}\n${m.bodyText.slice(0, 600)}`)
    );
  }
  if (selectedKbEntryIds?.length) {
    const { data: kbEntries } = await supabase
      .from("kb_entries")
      .select("title, content_md")
      .in("id", selectedKbEntryIds);
    sourceParts.push(...(kbEntries ?? []).map((e) => `${e.title}\n${e.content_md}`));
  }
  const sourceText = sourceParts.length ? sourceParts.join("\n---\n") : undefined;

  const post = await generateLinkedInPost({
    topic,
    voiceSamples,
    inspirationPost: inspirationPost?.trim() || undefined,
    sourceText,
    toneOverride: toneOverride?.trim() || undefined,
  });

  const { data: saved, error } = await supabase
    .from("linkedin_posts")
    .insert({ user_id: user.id, topic, content: post.content })
    .select("id, topic, content")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post: saved });
});
