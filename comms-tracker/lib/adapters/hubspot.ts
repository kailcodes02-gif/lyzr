import type {
  HubSpotData,
  NormalizedCompany,
  NormalizedContact,
  NormalizedDeal,
  NormalizedHubspotEmail,
  NormalizedOwner,
} from "./types";

// HubSpot CRM v3/v4. Private App token via `Authorization: Bearer`.
//
// IMPORTANT — this portal is large (~250k companies, ~170k contacts as of
// Phase 2 build time). A naive full-portal pagination sync would take
// tens of minutes and pull almost entirely irrelevant data: this tracker
// only cares about the handful of companies matching our Cortex-anchored
// account domains. So instead of listing everything, this adapter:
//   1. Searches companies by `domain IN [...]` against the caller-supplied
//      domain list (one call — HubSpot's search IN operator comfortably
//      handles tens of values).
//   2. Batch-reads company->contact and company->deal associations (v4)
//      for just the matched company ids.
//   3. Batch-reads only those specific contacts/deals (v3 batch/read).
// All batch/search endpoints cap at 100 inputs per call, so id lists are
// chunked; at this tracker's account-count scale that's usually one call.
//
// Deal stage labels and "is this closed-won" are per-pipeline, not global —
// `metadata.isClosed` on a HubSpot pipeline stage comes back as the STRING
// "true"/"false", not a boolean. Don't hardcode dealstage ids.

const BASE = "https://api.hubapi.com";
const BATCH_SIZE = 100;

async function hubspotPost<T>(token: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(new URL(path, BASE), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function hubspotGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(new URL(path, BASE), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type HSCompany = { id: string; properties: { name?: string; domain?: string; lifecyclestage?: string } };
type HSContact = {
  id: string;
  properties: { firstname?: string; lastname?: string; email?: string; jobtitle?: string; lifecyclestage?: string };
};
type HSDeal = { id: string; properties: { dealstage?: string; pipeline?: string; dealname?: string; hubspot_owner_id?: string } };
type HSPipeline = { id: string; stages: Array<{ id: string; metadata?: { isClosed?: string; probability?: string } }> };
type AssociationBatchResult = { results: Array<{ from: { id: string }; to: Array<{ toObjectId: number | string }> }> };
type HSOwner = { id: string; email?: string; firstName?: string; lastName?: string };
type HSEmail = {
  id: string;
  properties: {
    hs_email_subject?: string;
    hs_email_html?: string;
    hs_email_from_email?: string;
    hs_email_to_email?: string;
    hs_timestamp?: string;
  };
};

async function searchCompaniesByDomains(token: string, domains: string[]): Promise<HSCompany[]> {
  if (domains.length === 0) return [];
  const all: HSCompany[] = [];
  // HubSpot search comfortably handles far more than a typical account
  // count per IN filter, but chunk defensively rather than assume a limit.
  for (const batch of chunk(domains, 200)) {
    const res = await hubspotPost<{ results: HSCompany[] }>(token, "/crm/v3/objects/companies/search", {
      limit: 200,
      properties: ["name", "domain", "lifecyclestage"],
      filterGroups: [{ filters: [{ propertyName: "domain", operator: "IN", values: batch }] }],
    });
    all.push(...res.results);
  }
  return all;
}

async function batchReadAssociations(
  token: string,
  fromType: "companies" | "contacts",
  toType: "contacts" | "deals" | "emails",
  ids: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  for (const batch of chunk(ids, BATCH_SIZE)) {
    const res = await hubspotPost<AssociationBatchResult>(
      token,
      `/crm/v4/associations/${fromType}/${toType}/batch/read`,
      { inputs: batch.map((id) => ({ id })) }
    );
    for (const r of res.results) {
      map.set(
        r.from.id,
        r.to.map((t) => String(t.toObjectId))
      );
    }
  }
  return map;
}

async function batchReadObjects<T extends { id: string }>(
  token: string,
  objectType: "contacts" | "deals" | "emails",
  ids: string[],
  properties: string[]
): Promise<T[]> {
  const all: T[] = [];
  if (ids.length === 0) return all;
  for (const batch of chunk(ids, BATCH_SIZE)) {
    const res = await hubspotPost<{ results: T[] }>(token, `/crm/v3/objects/${objectType}/batch/read`, {
      properties,
      inputs: batch.map((id) => ({ id })),
    });
    all.push(...res.results);
  }
  return all;
}

async function fetchOwners(token: string): Promise<HSOwner[]> {
  const all: HSOwner[] = [];
  let after: string | undefined;
  do {
    const url = new URL("/crm/v3/owners/", BASE);
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`HubSpot /crm/v3/owners/ failed: ${res.status}`);
    const page = (await res.json()) as { results: HSOwner[]; paging?: { next?: { after: string } } };
    all.push(...page.results);
    after = page.paging?.next?.after;
  } while (after);
  return all;
}

async function fetchClosedWonStageIds(token: string): Promise<Set<string>> {
  const res = await hubspotGet<{ results: HSPipeline[] }>(token, "/crm/v3/pipelines/deals");
  const closedWon = new Set<string>();
  for (const pipeline of res.results) {
    for (const stage of pipeline.stages) {
      const isClosed = stage.metadata?.isClosed === "true";
      const probability = Number(stage.metadata?.probability ?? "0");
      if (isClosed && probability >= 1) closedWon.add(stage.id);
    }
  }
  return closedWon;
}

export async function fetchHubSpotDataForDomains(opts: {
  accessToken: string;
  domains: string[];
}): Promise<HubSpotData> {
  const { accessToken, domains } = opts;

  const companiesRaw = await searchCompaniesByDomains(accessToken, domains);
  const companyIds = companiesRaw.map((c) => c.id);

  const [contactAssoc, dealAssoc, closedWonStageIds, ownersRaw] = await Promise.all([
    batchReadAssociations(accessToken, "companies", "contacts", companyIds),
    batchReadAssociations(accessToken, "companies", "deals", companyIds),
    fetchClosedWonStageIds(accessToken),
    fetchOwners(accessToken),
  ]);

  const allContactIds = Array.from(new Set(Array.from(contactAssoc.values()).flat()));
  const allDealIds = Array.from(new Set(Array.from(dealAssoc.values()).flat()));

  const [contactsRaw, dealsRaw] = await Promise.all([
    batchReadObjects<HSContact>(accessToken, "contacts", allContactIds, [
      "firstname",
      "lastname",
      "email",
      "jobtitle",
      "lifecyclestage",
    ]),
    batchReadObjects<HSDeal>(accessToken, "deals", allDealIds, [
      "dealstage",
      "pipeline",
      "dealname",
      "hubspot_owner_id",
    ]),
  ]);

  // Association maps are company -> [contact/deal ids]; invert for the
  // per-contact/per-deal "which companies" shape the rest of sync expects.
  const companiesByContact = new Map<string, string[]>();
  for (const [companyId, contactIds] of contactAssoc) {
    for (const contactId of contactIds) {
      const list = companiesByContact.get(contactId) ?? [];
      list.push(companyId);
      companiesByContact.set(contactId, list);
    }
  }
  const companiesByDeal = new Map<string, string[]>();
  for (const [companyId, dealIds] of dealAssoc) {
    for (const dealId of dealIds) {
      const list = companiesByDeal.get(dealId) ?? [];
      list.push(companyId);
      companiesByDeal.set(dealId, list);
    }
  }

  const companies: NormalizedCompany[] = companiesRaw.map((c) => ({
    sourceId: c.id,
    name: c.properties.name ?? null,
    domain: c.properties.domain ?? null,
    lifecycleStage: c.properties.lifecyclestage ?? null,
    raw: c,
  }));

  const contacts: NormalizedContact[] = contactsRaw.map((c) => ({
    sourceId: c.id,
    fullName: [c.properties.firstname, c.properties.lastname].filter(Boolean).join(" ") || null,
    email: c.properties.email ?? null,
    jobTitle: c.properties.jobtitle ?? null,
    lifecycleStage: c.properties.lifecyclestage ?? null,
    associatedCompanyIds: companiesByContact.get(c.id) ?? [],
    raw: c,
  }));

  const deals: NormalizedDeal[] = dealsRaw.map((d) => ({
    sourceId: d.id,
    companyIds: companiesByDeal.get(d.id) ?? [],
    dealStage: d.properties.dealstage ?? "",
    pipeline: d.properties.pipeline ?? "",
    isClosedWon: closedWonStageIds.has(d.properties.dealstage ?? ""),
    ownerId: d.properties.hubspot_owner_id ?? null,
    raw: d,
  }));

  const owners: NormalizedOwner[] = ownersRaw.map((o) => ({
    sourceId: o.id,
    fullName: [o.firstName, o.lastName].filter(Boolean).join(" ") || null,
    email: o.email ?? null,
  }));

  // Email engagements (Sales/Gmail/Outlook sync logged against a contact)
  // are fetched per-contact via the same association pattern as
  // companies->contacts/deals — each email is already tied to a KNOWN
  // contact by construction, so no domain/email guessing is needed to
  // match it later, unlike Instantly's recipient-address matching.
  const contactEmailAssoc = await batchReadAssociations(accessToken, "contacts", "emails", allContactIds);
  const allEmailIds = Array.from(new Set(Array.from(contactEmailAssoc.values()).flat()));
  const emailsRaw = await batchReadObjects<HSEmail>(accessToken, "emails", allEmailIds, [
    "hs_email_subject",
    "hs_email_html",
    "hs_email_from_email",
    "hs_email_to_email",
    "hs_timestamp",
  ]);
  const emailsById = new Map(emailsRaw.map((e) => [e.id, e]));

  const contactEmails: NormalizedHubspotEmail[] = [];
  for (const [contactId, emailIds] of contactEmailAssoc) {
    for (const emailId of emailIds) {
      const email = emailsById.get(emailId);
      if (!email || !email.properties.hs_timestamp) continue;
      contactEmails.push({
        sourceId: email.id,
        contactId,
        subject: email.properties.hs_email_subject ?? null,
        bodyHtml: email.properties.hs_email_html ?? null,
        fromEmail: email.properties.hs_email_from_email ?? null,
        toEmail: email.properties.hs_email_to_email ?? null,
        sentAt: email.properties.hs_timestamp,
      });
    }
  }

  return { companies, contacts, deals, owners, contactEmails };
}
