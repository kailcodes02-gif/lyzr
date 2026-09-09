import type { SupabaseClient } from "@supabase/supabase-js";
import { htmlToText } from "../knowledge/util";
import { hasColumn, stripColumn } from "./db";
import { fetchHubSpotDataForDomains } from "../adapters/hubspot";
import { htmlToSnippet, isInternalEmail, normalizeDomain } from "./util";
import { upsertAccountPeopleBatch, upsertPeopleByEmailBatch } from "./people";
import {
  fetchCurrentProjectIdsByAccountId,
  resolveUnambiguousProjectIdByPersonId,
  upsertProjectOwnerRoles,
} from "./projects";
import { chunk, fetchAllRows } from "./batch";

// HubSpot reconciles against Cortex-anchored accounts by exact domain match
// only (Phase 2 v1 — no fuzzy matching yet). This portal has ~250k companies
// and ~170k contacts — nowhere close to all of it is relevant, so instead of
// listing the whole portal, this fetches ONLY companies (and their
// associated contacts/deals) matching our accounts' domains. See
// adapters/hubspot.ts for the targeted search/batch-read approach.
//
// Everything here is also batched rather than one-row-per-network-round-trip
// on the Supabase side — a naive per-record upsert loop made this sync take
// tens of minutes even before the domain-targeting fix.
export async function syncHubSpot(
  db: SupabaseClient,
  env: { HUBSPOT_ACCESS_TOKEN: string }
): Promise<{ fetched: number; upserted: number; flaggedForReview: number }> {
  // Fetched in full (paginated past PostgREST's 1000-row default cap) —
  // see fetchAllRows for why an un-ranged select here silently truncates
  // as these tables grow.
  const accounts = await fetchAllRows<{ id: string; primary_domain: string | null; canonical_name: string }>(() =>
    db.from("accounts").select("id, primary_domain, canonical_name").not("primary_domain", "is", null)
  );
  const accountIdByDomain = new Map(accounts.map((a) => [a.primary_domain!.toLowerCase(), a.id as string]));
  // Postgres checks NOT-NULL constraints (canonical_name has no default)
  // against the row PROPOSED for insertion before ON CONFLICT DO UPDATE
  // resolves — even for ids that are guaranteed to already exist — so a
  // partial-column upsert payload fails unless every NOT-NULL/no-default
  // column is included. Re-asserting the already-known value satisfies it.
  const canonicalNameById = new Map(accounts.map((a) => [a.id as string, a.canonical_name as string]));

  const data = await fetchHubSpotDataForDomains({
    accessToken: env.HUBSPOT_ACCESS_TOKEN,
    domains: Array.from(accountIdByDomain.keys()),
  });

  // Manual review decisions (Review page "Link"/"Ignore") are sticky —
  // once a human resolves a link, re-syncing must never silently undo it
  // by re-running domain matching over it. Rows with reviewed_at set are
  // excluded from auto-matching below and their existing account_id/
  // match_status/match_method carried forward unchanged.
  const reviewedRows = await fetchAllRows<{
    source_id: string;
    account_id: string | null;
    match_status: string;
    match_method: string | null;
  }>(() =>
    db
      .from("account_source_links")
      .select("source_id, account_id, match_status, match_method")
      .eq("source_system", "hubspot")
      .eq("source_object_type", "company")
      .not("reviewed_at", "is", null)
  );
  const reviewedBySourceId = new Map(reviewedRows.map((r) => [r.source_id, r]));

  const accountIdByHubspotCompanyId = new Map<string, string>();
  // Keyed by account id, not an array — more than one HubSpot company can
  // share the same domain (subsidiaries/duplicate records), and a batch
  // upsert containing two rows with the same conflict key errors ("cannot
  // affect row a second time"). Merge rather than dedupe-by-last: if ANY
  // matched company is lifecycle=customer, the account should end up
  // is_customer=true even if a duplicate record isn't.
  const accountUpdates = new Map<
    string,
    { id: string; canonical_name: string; hubspot_company_id: string; lifecycle_stage: string | null; is_customer: boolean }
  >();
  const linkRows: Array<Record<string, unknown>> = [];
  let flaggedForReview = 0;

  for (const company of data.companies) {
    const domain = normalizeDomain(company.domain);
    const reviewed = reviewedBySourceId.get(company.sourceId);
    const matchedAccountId = reviewed ? (reviewed.account_id ?? undefined) : (domain ? accountIdByDomain.get(domain) : undefined);

    if (matchedAccountId) {
      accountIdByHubspotCompanyId.set(company.sourceId, matchedAccountId);
      const existing = accountUpdates.get(matchedAccountId);
      accountUpdates.set(matchedAccountId, {
        id: matchedAccountId,
        canonical_name: canonicalNameById.get(matchedAccountId)!,
        hubspot_company_id: company.sourceId,
        lifecycle_stage: company.lifecycleStage ?? existing?.lifecycle_stage ?? null,
        is_customer: company.lifecycleStage === "customer" || Boolean(existing?.is_customer),
      });
    } else if (!reviewed) {
      flaggedForReview++;
    }

    linkRows.push({
      account_id: matchedAccountId ?? null,
      source_system: "hubspot",
      source_object_type: "company",
      source_id: company.sourceId,
      source_name: company.name,
      source_domain: domain,
      match_status: reviewed ? reviewed.match_status : matchedAccountId ? "matched" : "unmatched",
      match_method: reviewed ? reviewed.match_method : matchedAccountId ? "domain_exact" : null,
      raw: company.raw,
    });
  }

  for (const batch of chunk(Array.from(accountUpdates.values()), 500)) {
    // upsert-by-id is just a batched UPDATE here — every id already exists.
    const { error } = await db.from("accounts").upsert(batch, { onConflict: "id" });
    if (error) throw error;
  }
  for (const batch of chunk(linkRows, 500)) {
    const { error } = await db
      .from("account_source_links")
      .upsert(batch, { onConflict: "source_system,source_object_type,source_id" });
    if (error) throw error;
  }

  // A HubSpot "contact" on a deal/company is sometimes a Lyzr person (a
  // teammate CC'd on the deal, an internal test contact, etc.), not a real
  // external POC -- filed as client_poc here it would show up on the
  // account page as if they were the client. Same filter Cortex's own
  // contact ingestion applies, so client_poc means the same thing from
  // both sources: an address outside lyzr.ai/lyzr.com.
  const externalContacts = data.contacts.filter((c) => !isInternalEmail(c.email));
  const internalContactCount = data.contacts.length - externalContacts.length;
  if (internalContactCount > 0) {
    console.log(`HubSpot: ${internalContactCount} contact(s) on tracked deals are Lyzr addresses -- kept as lyzr_internal, not filed as client POCs`);
  }

  const personIdByEmail = await upsertPeopleByEmailBatch(
    db,
    externalContacts.map((c) => ({
      email: c.email,
      fullName: c.fullName,
      personType: "client_poc" as const,
      roleTitle: c.jobTitle,
      hubspotContactId: c.sourceId,
    }))
  );

  // HubSpot doesn't carry a primary/sponsor flag like Cortex's contacts —
  // default to client_poc_other. If Cortex already established a more
  // specific role for the same person on this account, this adds a second
  // (role-distinct) row rather than overwriting it; a minor redundancy
  // acceptable for v1.
  const accountPeopleRows: Array<{
    accountId: string;
    personId: string;
    relationshipRole: "client_poc_other";
    sourceSystem: "hubspot";
  }> = [];
  // Reused below for email-engagement matching — each HubSpot contact
  // already tells us exactly which person/account it is, no guessing.
  // Internal contacts are matched by email directly (not through
  // personIdByEmail, which only covers externalContacts) so their email
  // activity still reconciles even though they never get a client_poc link.
  const personIdByContactId = new Map<string, string>();
  const accountIdByContactId = new Map<string, string>();
  for (const contact of data.contacts) {
    const email = contact.email?.trim().toLowerCase();
    if (!email) continue;
    const accountId = contact.associatedCompanyIds
      .map((id) => accountIdByHubspotCompanyId.get(id))
      .find((id): id is string => Boolean(id));

    if (isInternalEmail(email)) {
      const { data: internalPerson } = await db.from("people").select("id").eq("email", email).maybeSingle();
      if (internalPerson) {
        personIdByContactId.set(contact.sourceId, internalPerson.id as string);
        if (accountId) accountIdByContactId.set(contact.sourceId, accountId);
      }
      continue;
    }

    const personId = personIdByEmail.get(email);
    if (!personId || personId === "__pending__") continue;
    personIdByContactId.set(contact.sourceId, personId);
    if (!accountId) continue;
    accountIdByContactId.set(contact.sourceId, accountId);
    accountPeopleRows.push({ accountId, personId, relationshipRole: "client_poc_other", sourceSystem: "hubspot" });
  }
  await upsertAccountPeopleBatch(db, accountPeopleRows);

  // Email engagements: recipient_email is always the CONTACT's own address
  // (regardless of which direction the email actually went) so grouping by
  // recipient/person stays consistent with Instantly's per-contact view —
  // `direction` carries whether it was sent to them or received from them.
  const contactEmailById = new Map(
    data.contacts.filter((c) => c.email).map((c) => [c.sourceId, c.email!.trim().toLowerCase()])
  );
  // One HubSpot email engagement can be associated with several contacts at
  // once (CC'd/group thread), but our schema uniquely keys one
  // communication_events row per source email id — a batch upsert with the
  // same id twice errors the same way duplicate account_people rows did.
  // Prefer whichever associated contact is the actual from/to party over one
  // that's merely CC'd; otherwise keep the first seen (deterministic, if
  // arbitrary). A genuine per-recipient fan-out would need a schema change
  // (unique on event+recipient instead of just event) — not done for v1.
  const projectIdByPersonId = await resolveUnambiguousProjectIdByPersonId(
    db,
    Array.from(personIdByContactId.values())
  );
  const emailRowByEventId = new Map<string, Record<string, unknown>>();
  for (const email of data.contactEmails) {
    const contactEmail = contactEmailById.get(email.contactId);
    if (!contactEmail) continue;
    const personId = personIdByContactId.get(email.contactId) ?? null;
    const accountId = accountIdByContactId.get(email.contactId) ?? null;
    const isFromContact = email.fromEmail?.trim().toLowerCase() === contactEmail;
    const isToContact = email.toEmail?.trim().toLowerCase() === contactEmail;
    const matchStatus = personId && accountId ? "matched" : personId ? "account_unmatched" : "person_unmatched";

    const existing = emailRowByEventId.get(email.sourceId);
    if (existing && !isFromContact && !isToContact) continue; // existing row already primary or equally arbitrary

    emailRowByEventId.set(email.sourceId, {
      account_id: accountId,
      person_id: personId,
      project_id: personId ? (projectIdByPersonId.get(personId) ?? null) : null,
      direction: isFromContact ? "inbound" : "outbound",
      source_system: "hubspot_engagement",
      source_event_id: email.sourceId,
      sender_email: email.fromEmail,
      recipient_email: contactEmail,
      recipient_email_domain: normalizeDomain(contactEmail.split("@")[1]),
      subject: email.subject,
      snippet: htmlToSnippet(email.bodyHtml),
      body_text: email.bodyHtml ? htmlToText(email.bodyHtml, 20000) : null,
      sent_at: email.sentAt,
      match_status: matchStatus,
      origin: "synced",
    });
  }
  let emailRows = Array.from(emailRowByEventId.values());
  if (!(await hasColumn(db, "communication_events", "body_text"))) {
    console.warn("HubSpot: communication_events.body_text missing (run migration 011) — storing snippets only this run");
    emailRows = stripColumn(emailRows, "body_text");
  }
  let emailsUpserted = 0;
  for (const batch of chunk(emailRows, 500)) {
    const { error } = await db
      .from("communication_events")
      .upsert(batch, { onConflict: "source_system,source_event_id" });
    if (error) throw error;
    emailsUpserted += batch.length;
  }

  const dealAccountUpdates = new Map<
    string,
    { id: string; canonical_name: string; is_customer: boolean; deal_stage_bucket: string }
  >();
  for (const deal of data.deals) {
    if (!deal.isClosedWon) continue;
    const accountId = deal.companyIds
      .map((id) => accountIdByHubspotCompanyId.get(id))
      .find((id): id is string => Boolean(id));
    if (!accountId) continue;
    dealAccountUpdates.set(accountId, {
      id: accountId,
      canonical_name: canonicalNameById.get(accountId)!,
      is_customer: true,
      deal_stage_bucket: deal.dealStage,
    });
  }
  for (const batch of chunk(Array.from(dealAccountUpdates.values()), 500)) {
    const { error } = await db.from("accounts").upsert(batch, { onConflict: "id" });
    if (error) throw error;
  }

  // Deal owners (the HubSpot sales rep assigned to the account's deal) are
  // one of the three configurable project-level owner roles (role_key
  // 'deal_owner') — but HubSpot has no native project concept, so this
  // account-level signal fans out to every one of the account's CURRENT
  // projects by default. A project with an admin manual override for
  // 'deal_owner' is skipped automatically by upsertProjectOwnerRoles.
  // Considered for ANY deal with an owner, not just closed-won ones —
  // ownership is about the relationship, not deal stage.
  const ownerById = new Map(data.owners.map((o) => [o.sourceId, o]));
  const dealOwnerPersonIdByEmail = await upsertPeopleByEmailBatch(
    db,
    data.owners
      .filter((o) => o.email)
      .map((o) => ({ email: o.email, fullName: o.fullName, personType: "lyzr_internal" as const }))
  );
  const dealOwnerByAccountId = new Map<string, string>();
  for (const deal of data.deals) {
    if (!deal.ownerId) continue;
    const owner = ownerById.get(deal.ownerId);
    const email = owner?.email?.trim().toLowerCase();
    const personId = email ? dealOwnerPersonIdByEmail.get(email) : undefined;
    if (!personId || personId === "__pending__") continue;
    const accountId = deal.companyIds
      .map((id) => accountIdByHubspotCompanyId.get(id))
      .find((id): id is string => Boolean(id));
    if (!accountId) continue;
    dealOwnerByAccountId.set(accountId, personId);
  }
  const projectIdsByAccountId = await fetchCurrentProjectIdsByAccountId(
    db,
    Array.from(dealOwnerByAccountId.keys())
  );
  const dealOwnerRoleRows: Array<{
    projectId: string;
    personId: string;
    roleKey: "deal_owner";
    sourceSystem: "hubspot";
  }> = [];
  for (const [accountId, personId] of dealOwnerByAccountId) {
    for (const projectId of projectIdsByAccountId.get(accountId) ?? []) {
      dealOwnerRoleRows.push({ projectId, personId, roleKey: "deal_owner", sourceSystem: "hubspot" });
    }
  }
  await upsertProjectOwnerRoles(db, dealOwnerRoleRows);

  return {
    fetched: data.companies.length + data.contacts.length + data.deals.length + data.contactEmails.length,
    upserted: accountUpdates.size + data.contacts.length + emailsUpserted,
    flaggedForReview,
  };
}
