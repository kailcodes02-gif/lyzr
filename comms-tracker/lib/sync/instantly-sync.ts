import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchInstantlyCampaigns,
  fetchInstantlyEmailsForCampaign,
  resolveCampaignIdsForTagLabel,
} from "../adapters/instantly";
import { htmlToText } from "../knowledge/util";
import { hasColumn, stripColumn } from "./db";
import { emailDomain, htmlToSnippet, normalizeEmail } from "./util";
import { chunk, fetchAllRows } from "./batch";
import { resolveUnambiguousProjectIdByPersonId } from "./projects";

// Classification is tag-driven (per plan): campaigns tagged with the team's
// chosen "product update" label get email_type='product_update'. Until that
// tag exists (it's not defined yet as of Phase 2), this falls back to
// syncing ALL campaigns with email_type=null so the pipeline is testable —
// not a decision to keep once the real tag exists, just how Phase 2 avoids
// shipping an empty dashboard.
//
// communication_events are upserted in batches per campaign rather than one
// row per network round trip — the same lesson as hubspot-sync.ts.
export async function syncInstantly(
  db: SupabaseClient,
  env: { INSTANTLY_API_KEY: string; INSTANTLY_PRODUCT_UPDATE_TAG?: string },
  log: (msg: string) => void = () => {}
): Promise<{ fetched: number; upserted: number; flaggedForReview: number }> {
  const campaigns = await fetchInstantlyCampaigns({ apiKey: env.INSTANTLY_API_KEY });

  for (const batch of chunk(
    campaigns.map((c) => ({ id: c.sourceId, name: c.name, status: c.status, tags: c.tags })),
    500
  )) {
    const { error } = await db.from("instantly_campaigns").upsert(batch, { onConflict: "id" });
    if (error) throw error;
  }

  let taggedCampaignIds: Set<string> | null = null;
  let emailType: "product_update" | null = null;
  if (env.INSTANTLY_PRODUCT_UPDATE_TAG) {
    taggedCampaignIds = await resolveCampaignIdsForTagLabel(env.INSTANTLY_API_KEY, env.INSTANTLY_PRODUCT_UPDATE_TAG);
    emailType = "product_update";
  }

  // Instantly's real rate limit is 20 requests/minute, and every campaign
  // needs at least one /emails call — with 300+ campaigns in this org,
  // syncing "all of them" as a no-tag fallback would take 15-60+ minutes
  // and mostly fetch campaigns nobody cares about for this tracker. Capped
  // to the most recently active campaigns instead, logged explicitly (never
  // silently) so it's clear this is a Phase 2 stopgap, not the real scope —
  // once the team's actual tag exists, the cap doesn't apply.
  const NO_TAG_FALLBACK_CAMPAIGN_CAP = 20;

  let campaignsToSync = campaigns.map((c) => c.sourceId);
  if (taggedCampaignIds) {
    campaignsToSync = campaignsToSync.filter((id) => taggedCampaignIds!.has(id));
    log(`Instantly: syncing ${campaignsToSync.length} campaign(s) tagged "${env.INSTANTLY_PRODUCT_UPDATE_TAG}"`);
  } else {
    emailType = null;
    const total = campaignsToSync.length;
    const mostRecent = [...campaigns]
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      .slice(0, NO_TAG_FALLBACK_CAMPAIGN_CAP);
    campaignsToSync = mostRecent.map((c) => c.sourceId);
    log(
      (env.INSTANTLY_PRODUCT_UPDATE_TAG
        ? `Instantly: tag "${env.INSTANTLY_PRODUCT_UPDATE_TAG}" not found yet — `
        : `Instantly: no product-update tag configured — `) +
        `falling back to the ${campaignsToSync.length} most recently updated of ${total} campaigns, unclassified (Phase 2 stopgap, not the real scope)`
    );
  }

  // Both fetched in full (paginated past PostgREST's 1000-row default cap)
  // rather than filtered per-email — matching happens against the whole
  // known universe of accounts/people, and `people` alone is already past
  // 4000 rows, well beyond what a single un-ranged select would return.
  const accounts = await fetchAllRows<{ id: string; primary_domain: string | null }>(() =>
    db.from("accounts").select("id, primary_domain").not("primary_domain", "is", null)
  );
  const accountIdByDomain = new Map(accounts.map((a) => [a.primary_domain!.toLowerCase(), a.id as string]));

  const people = await fetchAllRows<{ id: string; email: string | null }>(() =>
    db.from("people").select("id, email").not("email", "is", null)
  );
  const personIdByEmail = new Map(people.map((p) => [p.email!.toLowerCase(), p.id as string]));
  const projectIdByPersonId = await resolveUnambiguousProjectIdByPersonId(db, Array.from(personIdByEmail.values()));

  let fetched = 0;
  let upserted = 0;
  let flaggedForReview = 0;

  for (const campaignId of campaignsToSync) {
    const emails = await fetchInstantlyEmailsForCampaign(env.INSTANTLY_API_KEY, campaignId);
    fetched += emails.length;
    if (emails.length === 0) continue;

    const rows: Array<Record<string, unknown>> = [];
    for (const email of emails) {
      const recipientEmail = normalizeEmail(email.recipientEmail);
      if (!recipientEmail) continue;

      const personId = personIdByEmail.get(recipientEmail) ?? null;
      const domain = emailDomain(recipientEmail);
      const accountId = (domain && accountIdByDomain.get(domain)) ?? null;

      const matchStatus =
        personId && accountId
          ? "matched"
          : personId
            ? "account_unmatched"
            : accountId
              ? "person_unmatched"
              : "both_unmatched";
      if (matchStatus !== "matched") flaggedForReview++;

      rows.push({
        account_id: accountId,
        person_id: personId,
        project_id: personId ? (projectIdByPersonId.get(personId) ?? null) : null,
        source_system: "instantly",
        source_event_id: email.sourceId,
        source_campaign_id: email.campaignId,
        sender_email: email.senderEmail,
        recipient_email: recipientEmail,
        recipient_email_domain: domain,
        subject: email.subject,
        snippet: htmlToSnippet(email.bodyHtml),
        body_text: email.bodyHtml ? htmlToText(email.bodyHtml, 20000) : null,
        sent_at: email.sentAt,
        email_type: emailType,
        match_status: matchStatus,
        origin: "synced",
        raw: email.raw,
      });
    }

    const writable = (await hasColumn(db, "communication_events", "body_text")) ? rows : stripColumn(rows, "body_text");
    for (const batch of chunk(writable, 500)) {
      const { error } = await db
        .from("communication_events")
        .upsert(batch, { onConflict: "source_system,source_event_id" });
      if (error) throw error;
      upserted += batch.length;
    }
  }

  return { fetched: campaigns.length + fetched, upserted, flaggedForReview };
}
