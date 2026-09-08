"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export type MailboxConnection = {
  connected: boolean;
  accountEmail: string | null;
  scopes: string[];
  updatedAt: string | null;
  mailSyncedAt: string | null;
};

// Never selects refresh_token -- this is purely a "connected: yes/no, as
// whom, since when" status check for the /admin/sync UI, backed by
// user_oauth_tokens' "read_own" RLS policy (008_user_oauth_tokens.sql).
export function useMailboxConnections() {
  return useQuery({
    queryKey: ["mailbox-connections"],
    queryFn: async (): Promise<{ google: MailboxConnection; microsoft: MailboxConnection }> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("user_oauth_tokens")
        .select("provider, account_email, granted_scopes, updated_at, mail_synced_at");
      if (error) throw error;
      const empty: MailboxConnection = { connected: false, accountEmail: null, scopes: [], updatedAt: null, mailSyncedAt: null };
      const pick = (provider: string): MailboxConnection => {
        const row = (data ?? []).find((r) => r.provider === provider);
        if (!row) return empty;
        return {
          connected: true,
          accountEmail: (row.account_email as string | null) ?? null,
          scopes: (row.granted_scopes as string[] | null) ?? [],
          updatedAt: (row.updated_at as string) ?? null,
          mailSyncedAt: (row.mail_synced_at as string | null) ?? null,
        };
      };
      return { google: pick("google"), microsoft: pick("microsoft") };
    },
  });
}

// Supabase's incremental-authorization flow for an already-linked provider:
// re-running signInWithOAuth with extra scopes + prompt=consent forces
// Google to show the consent screen for just those scopes and reissue a
// refresh token, without disturbing the existing session/base login scopes.
// One consent covers both Drive (knowledge base) and Gmail (mailbox reading).
export async function connectGoogle(): Promise<void> {
  const supabase = createClient();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}${basePath}/auth/callback/?connect=google`,
      scopes: `${DRIVE_SCOPE} ${GMAIL_SCOPE}`,
      queryParams: {
        hd: "lyzr.ai",
        access_type: "offline",
        prompt: "consent",
      },
    },
  });
  if (error) throw error;
}

// Outlook goes through the Worker (it owns the Azure app registration), not
// Supabase Auth: ask it for the Microsoft authorize URL, then navigate there.
// Microsoft redirects back to the Worker's callback, which stores the token
// and bounces to /admin/sync?connected=outlook.
export async function connectMicrosoft(): Promise<void> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/oauth/microsoft/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error ?? `${res.status}`);
  window.location.href = body.url;
}
