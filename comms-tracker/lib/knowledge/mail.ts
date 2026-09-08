import type { SupabaseClient } from "@supabase/supabase-js";
import { rebuildInternalEmailMarkdown } from "../mail/run";

// The internal-email knowledge store (emails from siva@lyzr.ai /
// siva@lyzr.com) is populated by the per-user mailbox reads in
// lib/mail/run.ts -- every connected Gmail/Outlook mailbox contributes the
// messages it received from those senders. This knowledge-source entry
// point therefore has nothing to fetch on its own; it rebuilds the MD file
// from what the mailbox syncs have stored and reports the count, so the
// /admin/sync card and the weekly cron still have a meaningful result.
export async function ingestInternalEmail(
  db: SupabaseClient,
  _env: unknown,
  log: (msg: string) => void = () => {}
): Promise<{ fetched: number; upserted: number; flaggedForReview: number }> {
  const count = await rebuildInternalEmailMarkdown(db);
  if (count === 0) {
    log("internal_email: no emails from siva@lyzr.ai / siva@lyzr.com stored yet — connect a Gmail or Outlook mailbox on /admin/sync and run the mailbox sync (skipping)");
  } else {
    log(`internal_email: ${count} email(s) in the store (populated by the Gmail/Outlook mailbox syncs)`);
  }
  return { fetched: count, upserted: count, flaggedForReview: 0 };
}
