"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type SourceLinkRow = {
  id: string;
  source_system: string;
  source_object_type: string;
  source_id: string;
  source_name: string | null;
  source_domain: string | null;
  match_status: string;
  match_method: string | null;
};

export type UnmatchedEventRow = {
  id: string;
  source_system: string;
  sender_email: string | null;
  recipient_email: string;
  recipient_email_domain: string | null;
  subject: string | null;
  sent_at: string;
  match_status: string;
};

export function useReviewQueue() {
  return useQuery({
    queryKey: ["review-queue"],
    queryFn: async () => {
      const supabase = createClient();
      const [{ data: links, error: linksErr }, { data: events, error: eventsErr }] = await Promise.all([
        supabase
          .from("account_source_links")
          .select("id, source_system, source_object_type, source_id, source_name, source_domain, match_status, match_method")
          .neq("match_status", "matched")
          .order("source_name"),
        supabase
          .from("communication_events")
          .select("id, source_system, sender_email, recipient_email, recipient_email_domain, subject, sent_at, match_status")
          .neq("match_status", "matched")
          .order("sent_at", { ascending: false })
          .limit(200),
      ]);
      if (linksErr) throw linksErr;
      if (eventsErr) throw eventsErr;
      return {
        links: (links ?? []) as SourceLinkRow[],
        events: (events ?? []) as UnmatchedEventRow[],
      };
    },
  });
}
