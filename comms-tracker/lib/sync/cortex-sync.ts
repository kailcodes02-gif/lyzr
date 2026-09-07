import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchCortexData } from "../adapters/cortex";
import { normalizeDomain } from "./util";
import { upsertPersonByEmail } from "./people";
import { upsertProjectClientContactsBatch, upsertProjectOwnerRoles, upsertProjectsBatch } from "./projects";

// Cortex is the anchor source for "accounts we're engaged with" — every
// Cortex client becomes (or updates) an account directly, keyed on
// cortex_client_id. HubSpot sync reconciles against these by domain rather
// than the other way around: an unmatched HubSpot company does NOT spawn a
// new account in Phase 2 (it lands in the review queue instead), since the
// tracker's scope is Cortex-engaged accounts, not every HubSpot company.
export async function syncCortex(
  db: SupabaseClient,
  env: { CORTEX_BASE_URL: string; CORTEX_API_KEY: string }
): Promise<{ fetched: number; upserted: number; flaggedForReview: number }> {
  const data = await fetchCortexData({ baseUrl: env.CORTEX_BASE_URL, apiKey: env.CORTEX_API_KEY });

  let upserted = 0;
  const accountIdByClientSourceId = new Map<string, string>();

  for (const client of data.clients) {
    const domain = normalizeDomain(client.domain);

    const { data: account, error: accErr } = await db
      .from("accounts")
      .upsert(
        {
          cortex_client_id: client.sourceId,
          canonical_name: client.name,
          primary_domain: domain,
          product_engaged: client.productEngaged,
          product_links: client.productLinks,
        },
        { onConflict: "cortex_client_id" }
      )
      .select("id")
      .single();
    if (accErr) throw accErr;
    upserted++;
    accountIdByClientSourceId.set(client.sourceId, account.id as string);

    const { error: linkErr } = await db.from("account_source_links").upsert(
      {
        account_id: account.id,
        source_system: "cortex",
        source_object_type: "client",
        source_id: client.sourceId,
        source_name: client.name,
        source_domain: domain,
        match_status: "matched",
        raw: client.raw,
      },
      { onConflict: "source_system,source_object_type,source_id" }
    );
    if (linkErr) throw linkErr;
  }

  // Projects are batch-upserted in one pass, after every account exists, so
  // each project row can carry its resolved account_id.
  const projectIdByCortexId = await upsertProjectsBatch(
    db,
    data.projects
      .map((p) => ({ accountId: accountIdByClientSourceId.get(p.clientSourceId), cortexProjectId: p.sourceId, name: p.name, status: p.status }))
      .filter((p): p is { accountId: string; cortexProjectId: string; name: string; status: string | null } => Boolean(p.accountId))
  );

  const ownerRoleRows: Array<{
    projectId: string;
    personId: string;
    roleKey: "product_owner";
    sourceSystem: "cortex";
  }> = [];
  for (const owner of data.internalOwners) {
    const projectId = projectIdByCortexId.get(owner.projectId);
    if (!projectId || !owner.projectManager?.email) continue;
    const personId = await upsertPersonByEmail(db, {
      email: owner.projectManager.email,
      fullName: owner.projectManager.fullName,
      personType: "lyzr_internal",
      cortexPersonId: owner.projectManager.cortexPersonId,
    });
    if (personId) ownerRoleRows.push({ projectId, personId, roleKey: "product_owner", sourceSystem: "cortex" });
  }
  await upsertProjectOwnerRoles(db, ownerRoleRows);

  const clientContactRows: Array<{
    projectId: string;
    personId: string;
    relationshipRole: "client_poc_primary" | "client_poc_secondary" | "client_poc_other";
  }> = [];
  for (const contact of data.clientContacts) {
    const projectId = projectIdByCortexId.get(contact.projectId);
    if (!projectId) continue;
    const personId = await upsertPersonByEmail(db, {
      email: contact.email,
      fullName: contact.fullName,
      personType: "client_poc",
      roleTitle: contact.title,
    });
    if (personId) {
      clientContactRows.push({
        projectId,
        personId,
        relationshipRole: contact.isPrimary
          ? "client_poc_primary"
          : contact.isSponsor
            ? "client_poc_secondary"
            : "client_poc_other",
      });
    }
  }
  await upsertProjectClientContactsBatch(db, clientContactRows);

  return { fetched: data.clients.length, upserted, flaggedForReview: 0 };
}
