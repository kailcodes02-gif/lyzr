import { errorMessage } from "../sync/util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk, fetchAllRows } from "../sync/batch";
import { resolveUnambiguousProjectIdByPersonId } from "../sync/projects";
import { emailDomain } from "../sync/util";
import { ensureKnowledgeBucket, sha256Hex, writeKnowledgeMarkdown } from "../knowledge/util";
import { GMAIL_SCOPE, readGmail } from "./google";
import { isMicrosoftConfigured, readOutlook, type MicrosoftEnv } from "./microsoft";
import { INTERNAL_KNOWLEDGE_SENDERS, isInternalAddress, type MailboxRead, type MailMessage } from "./types";

export type MailProvider = "gmail" | "outlook";
export type MailEnv = MicrosoftEnv & { GOOGLE_OAUTH_CLIENT_ID?: string; GOOGLE_OAUTH_CLIENT_SECRET?: string };

type Connection = {
  user_id: string;
  provider: string;
  refresh_token: string;
  granted_scopes: string[] | null;
  account_email: string | null;
  mail_cursor: string | null;
};

type MatchContext = {
  accountIdByDomain: Map<string, string>;
  personIdByEmail: Map<string, string>;
  projectIdByPersonId: Map<string, string>;
};

async function loadMatchContext(db: SupabaseClient): Promise<MatchContext> {
  // Same universe the Instantly/HubSpot syncs match against: account by
  // recipient domain, person by exact email, project via the person's
  // unambiguous project membership.
  const accounts = await fetchAllRows<{ id: string; primary_domain: string | null }>(() =>
    db.from("accounts").select("id, primary_domain").not("primary_domain", "is", null)
  );
  const people = await fetchAllRows<{ id: string; email: string | null }>(() =>
    db.from("people").select("id, email").not("email", "is", null)
  );
  const personIdByEmail = new Map(people.map((p) => [p.email!.toLowerCase(), p.id as string]));
  return {
    accountIdByDomain: new Map(accounts.map((a) => [a.primary_domain!.toLowerCase(), a.id as string])),
    personIdByEmail,
    projectIdByPersonId: await resolveUnambiguousProjectIdByPersonId(db, Array.from(personIdByEmail.values())),
  };
}

// One communication_events row per (message, external counterpart) -- same
// granularity as Instantly. Messages with no known account or person on the
// other end are personal-inbox noise and are NOT stored at all: the tracker
// only ever keeps mail that touches a tracked customer.
function toEventRows(
  provider: MailProvider,
  mailboxUserId: string,
  mailboxEmail: string | null,
  messages: MailMessage[],
  ctx: MatchContext
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const m of messages) {
    const counterparts = (m.direction === "outbound" ? [...m.to, ...m.cc] : [m.from].filter((x): x is string => Boolean(x))).filter(
      (e) => !isInternalAddress(e)
    );
    for (const external of counterparts) {
      const personId = ctx.personIdByEmail.get(external) ?? null;
      const domain = emailDomain(external);
      const accountId = (domain && ctx.accountIdByDomain.get(domain)) ?? null;
      if (!personId && !accountId) continue;

      const sourceEventId = `${m.messageId}|${external}`;
      if (seen.has(sourceEventId)) continue;
      seen.add(sourceEventId);

      rows.push({
        account_id: accountId,
        person_id: personId,
        project_id: personId ? (ctx.projectIdByPersonId.get(personId) ?? null) : null,
        direction: m.direction,
        source_system: provider,
        source_event_id: sourceEventId,
        sender_email: m.direction === "outbound" ? (mailboxEmail ?? m.from) : m.from,
        recipient_email: m.direction === "outbound" ? external : (mailboxEmail ?? m.to[0] ?? "unknown"),
        recipient_email_domain: m.direction === "outbound" ? domain : emailDomain(mailboxEmail ?? m.to[0] ?? null),
        subject: m.subject,
        snippet: m.snippet,
        sent_at: m.sentAt,
        email_type: "manual_sales",
        match_status: personId && accountId ? "matched" : personId ? "account_unmatched" : "person_unmatched",
        origin: "synced",
        mailbox_user_id: mailboxUserId,
        raw: { provider, providerId: m.providerId, to: m.to, cc: m.cc, from: m.from },
      });
    }
  }
  return rows;
}

// The compose handoff logs an optimistic 'sent_via_app' row the moment the
// Gmail/Outlook compose window opens. Once the real sent message shows up in
// that user's mailbox (same recipient, same subject, sent after the log),
// stamp confirmed_at so the UI can tell "opened compose" from "actually sent".
async function confirmAppSends(db: SupabaseClient, sent: MailMessage[], log: (msg: string) => void): Promise<number> {
  if (sent.length === 0) return 0;
  const { data: pending, error } = await db
    .from("communication_events")
    .select("id, recipient_email, subject, sent_at")
    .eq("origin", "sent_via_app")
    .is("confirmed_at", null)
    .order("sent_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  if (!pending || pending.length === 0) return 0;

  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/^(re|fwd?):\s*/i, "");
  let confirmed = 0;
  for (const row of pending) {
    const match = sent.find(
      (m) =>
        m.to.includes((row.recipient_email as string).toLowerCase()) &&
        norm(m.subject) === norm(row.subject as string) &&
        new Date(m.sentAt).getTime() >= new Date(row.sent_at as string).getTime() - 5 * 60 * 1000
    );
    if (!match) continue;
    const { error: updErr } = await db.from("communication_events").update({ confirmed_at: match.sentAt }).eq("id", row.id);
    if (updErr) throw updErr;
    confirmed++;
  }
  if (confirmed) log(`${confirmed} "sent via app" row(s) confirmed against real sent mail`);
  return confirmed;
}

// Emails FROM siva@lyzr.ai / siva@lyzr.com, as seen in any connected
// mailbox, become the internal-email knowledge store the suggestion engine
// ranks alongside blog/Slack/Drive.
async function storeInternalEmails(db: SupabaseClient, internal: MailMessage[]): Promise<number> {
  if (internal.length === 0) return 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const m of internal) {
    if (!m.from || !INTERNAL_KNOWLEDGE_SENDERS.includes(m.from)) continue;
    const text = m.body ?? m.snippet ?? "";
    rows.push({
      source_type: "internal_email",
      source_ref: m.messageId,
      title: m.subject ?? "(no subject)",
      content_md: text,
      content_hash: await sha256Hex(text),
      published_at: m.sentAt,
      fetched_at: new Date().toISOString(),
    });
  }
  for (const batch of chunk(rows, 200)) {
    const { error } = await db.from("knowledge_documents").upsert(batch, { onConflict: "source_type,source_ref" });
    if (error) throw error;
  }
  return rows.length;
}

export async function rebuildInternalEmailMarkdown(db: SupabaseClient): Promise<number> {
  await ensureKnowledgeBucket(db);
  const { data: docs, error } = await db
    .from("knowledge_documents")
    .select("title, published_at, content_md")
    .eq("source_type", "internal_email")
    .order("published_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const body = (docs ?? [])
    .map((d) => `## ${d.title}\n${d.published_at}\n\n${(d.content_md as string | null)?.slice(0, 1500) ?? ""}\n`)
    .join("\n");
  await writeKnowledgeMarkdown(db, "internal-emails-siva.md", `# internal-emails-siva.md\n\n${body}`);
  return docs?.length ?? 0;
}

async function ingestMailbox(
  db: SupabaseClient,
  provider: MailProvider,
  env: MailEnv,
  log: (msg: string) => void
): Promise<{ fetched: number; upserted: number; flaggedForReview: number }> {
  const oauthProvider = provider === "gmail" ? "google" : "microsoft";
  if (provider === "outlook" && !isMicrosoftConfigured(env)) {
    log("outlook: MS_GRAPH_CLIENT_ID/SECRET not set — skipping (see SETUP_INTEGRATIONS.md)");
    return { fetched: 0, upserted: 0, flaggedForReview: 0 };
  }
  if (provider === "gmail" && !(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET)) {
    log("gmail: GOOGLE_OAUTH_CLIENT_ID/SECRET not set — skipping (see SETUP_INTEGRATIONS.md)");
    return { fetched: 0, upserted: 0, flaggedForReview: 0 };
  }

  const { data: connections, error: connErr } = await db
    .from("user_oauth_tokens")
    .select("user_id, provider, refresh_token, granted_scopes, account_email, mail_cursor")
    .eq("provider", oauthProvider);
  if (connErr) throw connErr;
  const usable = ((connections ?? []) as Connection[]).filter(
    (c) => provider === "outlook" || (c.granted_scopes ?? []).includes(GMAIL_SCOPE)
  );
  if (usable.length === 0) {
    log(`${provider}: no connected mailbox yet — use "Connect ${provider === "gmail" ? "Google" : "Outlook"}" on /admin/sync (existing Google connections made before Gmail was added need reconnecting)`);
    return { fetched: 0, upserted: 0, flaggedForReview: 0 };
  }

  const ctx = await loadMatchContext(db);
  let fetched = 0;
  let upserted = 0;
  let flagged = 0;

  for (const conn of usable) {
    const runStartedAt = new Date().toISOString();
    try {
      let read: MailboxRead;
      let rotatedRefreshToken: string | null = null;
      if (provider === "gmail") {
        read = await readGmail(env, conn.refresh_token, conn.mail_cursor);
      } else {
        const r = await readOutlook(env, conn.refresh_token, conn.mail_cursor);
        read = r;
        rotatedRefreshToken = r.rotatedRefreshToken;
      }
      fetched += read.sent.length + read.inbox.length + read.internal.length;

      const rows = toEventRows(provider, conn.user_id, conn.account_email, [...read.sent, ...read.inbox], ctx);
      flagged += rows.filter((r) => r.match_status !== "matched").length;
      for (const batch of chunk(rows, 500)) {
        const { error } = await db.from("communication_events").upsert(batch, { onConflict: "source_system,source_event_id" });
        if (error) throw error;
        upserted += batch.length;
      }

      await confirmAppSends(db, read.sent, log);
      const internalStored = await storeInternalEmails(db, read.internal);

      const patch: Record<string, unknown> = { mail_cursor: runStartedAt, mail_synced_at: runStartedAt };
      if (rotatedRefreshToken) patch.refresh_token = rotatedRefreshToken;
      const { error: cursorErr } = await db
        .from("user_oauth_tokens")
        .update(patch)
        .eq("user_id", conn.user_id)
        .eq("provider", oauthProvider);
      if (cursorErr) throw cursorErr;

      log(
        `${provider}: ${conn.account_email ?? conn.user_id}: ${read.sent.length} sent + ${read.inbox.length} inbox read, ${rows.length} customer touch(es) stored, ${internalStored} internal email(s)`
      );
    } catch (err) {
      // One user's revoked grant must not stop the other mailboxes.
      log(`${provider}: failed for ${conn.account_email ?? conn.user_id}: ${errorMessage(err)}`);
    }
  }

  await rebuildInternalEmailMarkdown(db);
  return { fetched, upserted, flaggedForReview: flagged };
}

// Same sync_runs / source_sync_state bookkeeping as lib/sync/run.ts and
// lib/knowledge/run.ts, keyed 'gmail' / 'outlook'.
export async function runMailboxSync(
  db: SupabaseClient,
  provider: MailProvider,
  env: MailEnv,
  opts: { runType: "manual" | "scheduled"; triggeredBy?: string | null }
): Promise<{ status: string; fetched: number; upserted: number; flaggedForReview: number }> {
  const { data: run, error: runErr } = await db
    .from("sync_runs")
    .insert({ source_system: provider, run_type: opts.runType, status: "running", triggered_by: opts.triggeredBy ?? null })
    .select("id")
    .single();
  if (runErr) throw runErr;

  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);
  try {
    const result = await ingestMailbox(db, provider, env, log);
    const status = result.upserted === 0 && logs.some((l) => l.includes("skipping") || l.includes("no connected")) ? "partial" : "success";
    await db
      .from("sync_runs")
      .update({
        status,
        finished_at: new Date().toISOString(),
        records_fetched: result.fetched,
        records_upserted: result.upserted,
        records_flagged_for_review: result.flaggedForReview,
        error_message: logs.length ? logs.join("\n").slice(0, 2000) : null,
      })
      .eq("id", run.id);
    await db
      .from("source_sync_state")
      .upsert({ source_key: provider, last_synced_at: new Date().toISOString(), last_run_id: run.id }, { onConflict: "source_key" });
    return { status, ...result };
  } catch (err) {
    const message = errorMessage(err);
    await db
      .from("sync_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error_message: message.slice(0, 2000) })
      .eq("id", run.id);
    throw err;
  }
}
