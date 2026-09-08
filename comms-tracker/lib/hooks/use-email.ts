"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type EmailDetail = {
  id: string;
  subject: string | null;
  sent_at: string;
  direction: string;
  sender_email: string | null;
  recipient_email: string;
  source_system: string;
  origin: string;
  match_status: string;
  confirmed_at: string | null;
  snippet: string | null;
  ai_summary: string | null;
  body_text: string | null;
  account: { id: string; canonical_name: string } | null;
  project: { id: string; name: string } | null;
  person: { id: string; full_name: string | null; email: string | null } | null;
};

// Fetched on demand when an email is opened -- the lists only carry the
// snippet, the full body is only worth pulling for the one you look at.
export function useEmailDetail(id: string | null) {
  return useQuery({
    queryKey: ["email-detail", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<EmailDetail> => {
      const supabase = createClient();
      const base = "id, subject, sent_at, direction, sender_email, recipient_email, source_system, origin, match_status, confirmed_at, snippet, ai_summary";
      const embeds = "account:accounts(id, canonical_name), project:projects(id, name), person:people(id, full_name, email)";
      let { data, error } = await supabase.from("communication_events").select(`${base}, body_text, ${embeds}`).eq("id", id!).single();
      // body_text arrives with migration 011; until it's applied, read
      // everything else and show the snippet.
      if (error && error.code === "42703") {
        ({ data, error } = await supabase.from("communication_events").select(`${base}, ${embeds}`).eq("id", id!).single());
      }
      if (error) throw error;
      const row = data as unknown as EmailDetail;
      return { ...row, body_text: row.body_text ?? null, account: row.account ?? null, project: row.project ?? null, person: row.person ?? null };
    },
  });
}
