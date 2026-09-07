"use client";

import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { TopicSuggestion } from "@/lib/ai/suggest";
import type { DraftEmail } from "@/lib/ai/draft";

// Same bearer-token-against-the-Worker pattern as /admin/sync's manual
// refresh -- these routes run in worker/index.ts, not as Supabase queries,
// since they call the Anthropic API server-side.
async function authedFetch(path: string, body?: unknown): Promise<Response> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text}`);
  }
  return res;
}

export function useSuggestTopics() {
  return useMutation({
    mutationFn: async (projectId: string): Promise<TopicSuggestion[]> => {
      const res = await authedFetch(`/api/ai/suggest/${projectId}`);
      const body = (await res.json()) as { suggestions: TopicSuggestion[] };
      return body.suggestions;
    },
  });
}

export function useDraftEmail() {
  return useMutation({
    mutationFn: async (input: {
      projectId: string;
      projectName: string;
      accountName: string;
      recipientName: string | null;
      selectedTopics: string[];
    }): Promise<DraftEmail> => {
      const res = await authedFetch("/api/ai/draft", input);
      const body = (await res.json()) as { draft: DraftEmail };
      return body.draft;
    },
  });
}

export function useLogSend() {
  return useMutation({
    mutationFn: async (input: {
      accountId: string;
      projectId?: string | null;
      personId?: string | null;
      recipientEmail: string;
      subject: string;
      snippet?: string | null;
    }) => {
      await authedFetch("/api/send/log", input);
    },
  });
}
