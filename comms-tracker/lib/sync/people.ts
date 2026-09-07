import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEmail } from "./util";
import { chunk, fetchAllRows, mapWithConcurrency } from "./batch";

type PersonInput = {
  email: string | null;
  fullName?: string | null;
  personType: "lyzr_internal" | "client_poc";
  roleTitle?: string | null;
  team?: string | null;
  cortexPersonId?: string | null;
  hubspotContactId?: string | null;
};

// Batched sibling of upsertPersonByEmail below — for sources with real
// volume (HubSpot's contact list, potentially thousands of rows), doing one
// SELECT+INSERT/UPDATE network round trip per person serializes the whole
// sync behind HTTP latency. This does ONE select of all existing people,
// resolves inserts vs. updates client-side, batches the inserts, and runs
// updates with bounded concurrency instead of one-at-a-time.
export async function upsertPeopleByEmailBatch(
  db: SupabaseClient,
  inputs: PersonInput[]
): Promise<Map<string, string>> {
  type ExistingPersonRow = {
    id: string;
    email: string | null;
    cortex_person_id: string | null;
    hubspot_contact_id: string | null;
    full_name: string | null;
    role_title: string | null;
    team: string | null;
  };
  const rows = await fetchAllRows<ExistingPersonRow>(() =>
    db.from("people").select("id, email, cortex_person_id, hubspot_contact_id, full_name, role_title, team")
  );
  const byEmail = new Map(rows.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p]));
  // cortex_person_id and hubspot_contact_id are ALSO unique-constrained
  // columns — if a source record's email changed since the last sync,
  // matching by email alone misses the existing row and tries to INSERT a
  // second one carrying the same already-used source id, which the DB
  // rejects. Fall back to these as alternate identity keys before deciding
  // a person is genuinely new.
  const byCortexId = new Map(rows.filter((p) => p.cortex_person_id).map((p) => [p.cortex_person_id as string, p]));
  const byHubspotId = new Map(rows.filter((p) => p.hubspot_contact_id).map((p) => [p.hubspot_contact_id as string, p]));

  const resultByEmail = new Map<string, string>();
  const toInsert: Array<Record<string, unknown>> = [];
  const toUpdate: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const patchedIds = new Set<string>();

  for (const input of inputs) {
    const email = normalizeEmail(input.email);
    if (!email || resultByEmail.has(email)) continue;

    const existing =
      byEmail.get(email) ??
      (input.cortexPersonId ? byCortexId.get(input.cortexPersonId) : undefined) ??
      (input.hubspotContactId ? byHubspotId.get(input.hubspotContactId) : undefined);

    if (existing) {
      resultByEmail.set(email, existing.id as string);
      if (patchedIds.has(existing.id as string)) continue;
      const patch: Record<string, unknown> = {};
      if (existing.email?.toLowerCase() !== email) patch.email = email;
      if (input.cortexPersonId && !existing.cortex_person_id) patch.cortex_person_id = input.cortexPersonId;
      if (input.hubspotContactId && !existing.hubspot_contact_id) patch.hubspot_contact_id = input.hubspotContactId;
      if (input.fullName && !existing.full_name) patch.full_name = input.fullName;
      if (input.roleTitle && !existing.role_title) patch.role_title = input.roleTitle;
      if (input.team && !existing.team) patch.team = input.team;
      if (Object.keys(patch).length > 0) {
        toUpdate.push({ id: existing.id as string, patch });
        patchedIds.add(existing.id as string);
      }
    } else {
      resultByEmail.set(email, "__pending__");
      toInsert.push({
        email,
        full_name: input.fullName ?? null,
        person_type: input.personType,
        role_title: input.roleTitle ?? null,
        team: input.team ?? null,
        cortex_person_id: input.cortexPersonId ?? null,
        hubspot_contact_id: input.hubspotContactId ?? null,
      });
    }
  }

  for (const batch of chunk(toInsert, 500)) {
    const { data: inserted, error } = await db.from("people").insert(batch).select("id, email");
    if (error) throw error;
    for (const row of inserted ?? []) resultByEmail.set((row.email as string).toLowerCase(), row.id as string);
  }

  await mapWithConcurrency(toUpdate, 20, async ({ id, patch }) => {
    const { error } = await db.from("people").update(patch).eq("id", id);
    if (error) throw error;
  });

  return resultByEmail;
}

// People can arrive from Cortex (cortex_person_id) and HubSpot
// (hubspot_contact_id) independently, but both are keyed to the same human
// by email. A plain upsert-by-source-id would collide with the table's
// separate UNIQUE(lower(email)) constraint the second time a different
// source introduces the same address, so identity resolution goes through
// email first: look the person up, then fill in whichever source id is new.
export async function upsertPersonByEmail(
  db: SupabaseClient,
  input: {
    email: string | null;
    fullName?: string | null;
    personType: "lyzr_internal" | "client_poc";
    roleTitle?: string | null;
    team?: string | null;
    cortexPersonId?: string | null;
    hubspotContactId?: string | null;
  }
): Promise<string | null> {
  const email = normalizeEmail(input.email);
  if (!email) return null;

  const { data: existing, error: selErr } = await db
    .from("people")
    .select("id, email, cortex_person_id, hubspot_contact_id, full_name, role_title, team")
    .or(
      [
        `email.ilike.${email}`,
        input.cortexPersonId ? `cortex_person_id.eq.${input.cortexPersonId}` : null,
        input.hubspotContactId ? `hubspot_contact_id.eq.${input.hubspotContactId}` : null,
      ]
        .filter(Boolean)
        .join(",")
    )
    .maybeSingle();
  if (selErr) throw selErr;

  if (existing) {
    // Same reasoning as upsertPeopleByEmailBatch: cortex_person_id/
    // hubspot_contact_id are unique-constrained, so if this source's email
    // changed since last sync, matching by email alone would miss the
    // existing row and try to insert a duplicate-source-id row instead.
    const patch: Record<string, unknown> = {};
    if (existing.email?.toLowerCase() !== email) patch.email = email;
    if (input.cortexPersonId && !existing.cortex_person_id) patch.cortex_person_id = input.cortexPersonId;
    if (input.hubspotContactId && !existing.hubspot_contact_id) patch.hubspot_contact_id = input.hubspotContactId;
    if (input.fullName && !existing.full_name) patch.full_name = input.fullName;
    if (input.roleTitle && !existing.role_title) patch.role_title = input.roleTitle;
    if (input.team && !existing.team) patch.team = input.team;
    if (Object.keys(patch).length > 0) {
      const { error } = await db.from("people").update(patch).eq("id", existing.id);
      if (error) throw error;
    }
    return existing.id as string;
  }

  const { data: inserted, error: insErr } = await db
    .from("people")
    .insert({
      email,
      full_name: input.fullName ?? null,
      person_type: input.personType,
      role_title: input.roleTitle ?? null,
      team: input.team ?? null,
      cortex_person_id: input.cortexPersonId ?? null,
      hubspot_contact_id: input.hubspotContactId ?? null,
    })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return inserted.id as string;
}

type AccountPersonRole =
  | "internal_owner"
  | "internal_contributor"
  | "client_poc_primary"
  | "client_poc_secondary"
  | "client_poc_other"
  | "deal_owner";

export async function upsertAccountPeopleBatch(
  db: SupabaseClient,
  rows: Array<{ accountId: string; personId: string; relationshipRole: AccountPersonRole; sourceSystem: "cortex" | "hubspot" | "instantly" }>
): Promise<void> {
  // Deduped defensively, not just by callers: the same (account, person,
  // role) pair can legitimately arise twice from upstream data (e.g. one
  // contact associated with two duplicate HubSpot company records that
  // both resolve to the same account) — a batch upsert containing the same
  // conflict key twice errors ("cannot affect row a second time").
  const deduped = new Map(
    rows.map((r) => [`${r.accountId}:${r.personId}:${r.relationshipRole}`, r])
  );
  const payload = Array.from(deduped.values()).map((r) => ({
    account_id: r.accountId,
    person_id: r.personId,
    relationship_role: r.relationshipRole,
    source_system: r.sourceSystem,
    is_current: true,
  }));
  for (const batch of chunk(payload, 500)) {
    const { error } = await db
      .from("account_people")
      .upsert(batch, { onConflict: "account_id,person_id,relationship_role" });
    if (error) throw error;
  }
}

export async function upsertAccountPerson(
  db: SupabaseClient,
  input: {
    accountId: string;
    personId: string;
    relationshipRole:
      | "internal_owner"
      | "internal_contributor"
      | "client_poc_primary"
      | "client_poc_secondary"
      | "client_poc_other";
    sourceSystem: "cortex" | "hubspot" | "instantly";
  }
): Promise<void> {
  const { error } = await db.from("account_people").upsert(
    {
      account_id: input.accountId,
      person_id: input.personId,
      relationship_role: input.relationshipRole,
      source_system: input.sourceSystem,
      is_current: true,
    },
    { onConflict: "account_id,person_id,relationship_role" }
  );
  if (error) throw error;
}
