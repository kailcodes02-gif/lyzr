import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateLinkedInPost } from "@/lib/ai/claude";
import { getValidAccessToken } from "@/lib/google/oauth";
import { searchMessages } from "@/lib/google/gmail";
import { buildGmailQuery } from "@/lib/gmail/queries";
import { withErrorHandling } from "@/lib/api/with-error-handling";

interface RequestBody {
  topic: string;
  inspirationPost?: string;
  toneOverride?: string;
  useEmailSources?: boolean;
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { topic, inspirationPost, toneOverride, useEmailSources } = (await request.json()) as RequestBody;
  if (!topic?.trim()) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const { data: sampleRows } = await supabase
    .from("linkedin_voice_samples")
    .select("content")
    .eq("user_id", user.id)
    .order("position", { ascending: true });
  const voiceSamples = (sampleRows ?? []).map((s) => s.content);

  let sourceText: string | undefined;
  if (useEmailSources) {
    try {
      const accessToken = await getValidAccessToken(user.id);
      const query = buildGmailQuery("mofu", "general");
      const messages = await searchMessages(accessToken, query, 8);
      sourceText = messages
        .map((m) => `From: ${m.from} | ${m.subject}\n${m.bodyText.slice(0, 600)}`)
        .join("\n---\n");
    } catch (err) {
      console.warn("Skipping email sources for LinkedIn generation:", err);
    }
  }

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
