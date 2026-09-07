import type { SupabaseClient } from "@supabase/supabase-js";

const INTERNAL_EMAIL_SENDERS = ["siva@lyzr.ai", "siva@lyzr.com"];

// Scaffold only -- needs read access to siva@lyzr.ai's actual mailbox, which
// means either Google Workspace domain-wide delegation (a service account
// impersonating that one mailbox) or Siva personally granting Gmail/Outlook
// read scope at sign-in. Same missing-app problem as drive.ts/slack.ts.
// See SETUP_INTEGRATIONS.md.
export function isMailConfigured(env: { GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON?: string; MS_GRAPH_CLIENT_SECRET?: string }): boolean {
  return Boolean(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON || env.MS_GRAPH_CLIENT_SECRET);
}

export async function ingestInternalEmail(
  _db: SupabaseClient,
  env: { GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON?: string; MS_GRAPH_CLIENT_SECRET?: string },
  log: (msg: string) => void = () => {}
): Promise<{ fetched: number; upserted: number; flaggedForReview: number }> {
  if (!isMailConfigured(env)) {
    log(`internal_email: no mail credentials configured for ${INTERNAL_EMAIL_SENDERS.join("/")} — skipping (see SETUP_INTEGRATIONS.md)`);
    return { fetched: 0, upserted: 0, flaggedForReview: 0 };
  }

  // TODO once mail-read credentials exist: Gmail messages.list (query
  // `from:siva@lyzr.ai OR from:siva@lyzr.com`) or Microsoft Graph
  // /me/messages with a $filter on sender, incremental via a stored
  // historyId/deltaLink -> knowledge_documents upsert
  // (source_type='internal_email', source_ref=messageId) ->
  // writeKnowledgeMarkdown to `internal-emails-siva.md`.
  log("internal_email: adapter not yet implemented against real credentials");
  return { fetched: 0, upserted: 0, flaggedForReview: 0 };
}
