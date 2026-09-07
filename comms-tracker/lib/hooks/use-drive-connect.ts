"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

// Never selects refresh_token -- this is purely a "connected: yes/no, since
// when" status check for the /admin/sync UI, backed by user_oauth_tokens'
// "read_own" RLS policy (008_user_oauth_tokens.sql).
export function useDriveConnection() {
  return useQuery({
    queryKey: ["drive-connection"],
    queryFn: async (): Promise<{ connected: boolean; updatedAt: string | null }> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("user_oauth_tokens")
        .select("updated_at")
        .eq("provider", "google_drive")
        .maybeSingle();
      if (error) throw error;
      return { connected: Boolean(data), updatedAt: (data?.updated_at as string) ?? null };
    },
  });
}

// Supabase's incremental-authorization flow for an already-linked provider:
// re-running signInWithOAuth with an extra scope + prompt=consent forces
// Google to show the consent screen for just that new scope and reissue a
// refresh token, without disturbing the existing session/base login scopes.
export async function connectGoogleDrive(): Promise<void> {
  const supabase = createClient();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}${basePath}/auth/callback/?connect=drive`,
      scopes: "https://www.googleapis.com/auth/drive.readonly",
      queryParams: {
        hd: "lyzr.ai",
        access_type: "offline",
        prompt: "consent",
      },
    },
  });
  if (error) throw error;
}
