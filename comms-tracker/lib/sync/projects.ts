import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk, ID_FILTER_CHUNK_SIZE } from "./batch";

type ProjectStatus = "active" | "paused" | "completed" | "unknown";

// Cortex's own status vocabulary doesn't match the app's project_status
// enum 1:1 (e.g. it sends "in_progress", not "active") -- normalize instead
// of casting the raw string straight into the enum column, which errors
// (Postgres 22P02) the moment Cortex uses a spelling this enum doesn't have.
// Unrecognized values fall back to "unknown" rather than failing the sync.
function normalizeProjectStatus(raw: string | null): ProjectStatus {
  if (!raw) return "unknown";
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (key) {
    case "active":
    case "in_progress":
    case "ongoing":
    case "started":
    case "open":
      return "active";
    case "paused":
    case "on_hold":
    case "hold":
    case "stalled":
      return "paused";
    case "completed":
    case "complete":
    case "done":
    case "closed":
    case "finished":
      return "completed";
    default:
      return "unknown";
  }
}

// Batched sibling of cortex-sync's old one-row-at-a-time project upsert --
// same reasoning as upsertPeopleByEmailBatch in people.ts: one network
// round trip per project doesn't scale past a handful of accounts.
export async function upsertProjectsBatch(
  db: SupabaseClient,
  rows: Array<{ accountId: string; cortexProjectId: string; name: string; status: string | null }>
): Promise<Map<string, string>> {
  const byCortexProjectId = new Map<string, string>();
  for (const batch of chunk(rows, 500)) {
    const payload = batch.map((r) => ({
      account_id: r.accountId,
      cortex_project_id: r.cortexProjectId,
      name: r.name,
      status: normalizeProjectStatus(r.status),
    }));
    const { data, error } = await db
      .from("projects")
      .upsert(payload, { onConflict: "cortex_project_id" })
      .select("id, cortex_project_id");
    if (error) throw error;
    for (const row of data ?? []) {
      byCortexProjectId.set(row.cortex_project_id as string, row.id as string);
    }
  }
  return byCortexProjectId;
}

type ProjectPersonRow = {
  project_id: string;
  person_id: string;
  role_key: string | null;
  relationship_role: string | null;
  source_system: string;
  is_current: boolean;
  is_manual_override?: boolean;
};

// project_people's two natural keys (role_key IS NOT NULL / relationship_role
// IS NOT NULL) are PARTIAL unique indexes (see 006_projects_and_roles.sql) --
// PostgREST's upsert only ever emits a plain `ON CONFLICT (columns)` with no
// WHERE clause, and Postgres can't infer a partial index without one, so
// `.upsert(rows, { onConflict: "project_id,person_id,role_key" })` 42P10s.
// Do it manually instead: look up existing ids by the same natural key, then
// split into insert (no existing row) vs. update-by-primary-key, which
// targets project_people's actual (non-partial) primary key index.
async function upsertProjectPeopleRows(db: SupabaseClient, rows: ProjectPersonRow[]): Promise<void> {
  if (rows.length === 0) return;

  const naturalKey = (r: { project_id: string; person_id: string; role_key: string | null; relationship_role: string | null }) =>
    `${r.project_id}:${r.person_id}:${r.role_key ?? ""}:${r.relationship_role ?? ""}`;

  const projectIds = Array.from(new Set(rows.map((r) => r.project_id)));
  const existingIdByKey = new Map<string, string>();
  for (const batch of chunk(projectIds, ID_FILTER_CHUNK_SIZE)) {
    const { data, error } = await db
      .from("project_people")
      .select("id, project_id, person_id, role_key, relationship_role")
      .in("project_id", batch);
    if (error) throw error;
    for (const row of data ?? []) {
      existingIdByKey.set(
        naturalKey({
          project_id: row.project_id as string,
          person_id: row.person_id as string,
          role_key: row.role_key as string | null,
          relationship_role: row.relationship_role as string | null,
        }),
        row.id as string
      );
    }
  }

  const toInsert: ProjectPersonRow[] = [];
  const toUpdate: Array<{ id: string } & ProjectPersonRow> = [];
  for (const row of rows) {
    const id = existingIdByKey.get(naturalKey(row));
    if (id) toUpdate.push({ id, ...row });
    else toInsert.push(row);
  }

  for (const batch of chunk(toInsert, 500)) {
    const { error } = await db.from("project_people").insert(batch);
    if (error) throw error;
  }
  for (const batch of chunk(toUpdate, 500)) {
    const { error } = await db.from("project_people").upsert(batch, { onConflict: "id" });
    if (error) throw error;
  }
}

type OwnerRoleRow = {
  projectId: string;
  personId: string;
  roleKey: "product_owner" | "deal_owner" | "project_owner";
  sourceSystem: "cortex" | "hubspot" | "manual";
};

// Writes the three configurable internal owner roles (Product/Deal/Project
// Owner). Admin manual overrides are sticky at the (project, role) grain --
// not (project, person, role) -- because the point of an override is that
// sync stops asserting ITS OWN pick for that role on that project at all,
// regardless of which person it would have picked. Without this, a manual
// reassignment away from Cortex's auto-derived PM would just get a second
// "Product Owner" row added back in on the next sync.
export async function upsertProjectOwnerRoles(db: SupabaseClient, rows: OwnerRoleRow[]): Promise<void> {
  if (rows.length === 0) return;

  const projectIds = Array.from(new Set(rows.map((r) => r.projectId)));
  const lockedRoleByProject = new Set<string>();
  for (const batch of chunk(projectIds, ID_FILTER_CHUNK_SIZE)) {
    const { data, error } = await db
      .from("project_people")
      .select("project_id, role_key")
      .in("project_id", batch)
      .eq("is_manual_override", true)
      .not("role_key", "is", null);
    if (error) throw error;
    for (const row of data ?? []) lockedRoleByProject.add(`${row.project_id}:${row.role_key}`);
  }

  const deduped = new Map(rows.map((r) => [`${r.projectId}:${r.personId}:${r.roleKey}`, r]));
  const payload = Array.from(deduped.values())
    .filter((r) => !lockedRoleByProject.has(`${r.projectId}:${r.roleKey}`))
    .map((r) => ({
      project_id: r.projectId,
      person_id: r.personId,
      role_key: r.roleKey,
      relationship_role: null,
      source_system: r.sourceSystem,
      is_manual_override: false,
      is_current: true,
    }));

  await upsertProjectPeopleRows(db, payload);
}

type ClientContactRow = {
  projectId: string;
  personId: string;
  relationshipRole: "client_poc_primary" | "client_poc_secondary" | "client_poc_other";
};

export async function upsertProjectClientContactsBatch(db: SupabaseClient, rows: ClientContactRow[]): Promise<void> {
  if (rows.length === 0) return;
  // Same defensive dedupe as upsertAccountPeopleBatch -- a batch upsert
  // containing the same conflict key twice errors ("cannot affect row a
  // second time").
  const deduped = new Map(rows.map((r) => [`${r.projectId}:${r.personId}:${r.relationshipRole}`, r]));
  const payload = Array.from(deduped.values()).map((r) => ({
    project_id: r.projectId,
    person_id: r.personId,
    role_key: null,
    relationship_role: r.relationshipRole,
    source_system: "cortex" as const,
    is_current: true,
  }));
  await upsertProjectPeopleRows(db, payload);
}

// Best-effort project attribution for a communication_events row: a person
// often sits on exactly one current project, in which case that email
// obviously belongs to it for going-dark grading. Ambiguous people (on more
// than one project for the account) are left unattributed rather than
// guessed at -- the email still counts at the account level either way.
export async function resolveUnambiguousProjectIdByPersonId(
  db: SupabaseClient,
  personIds: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const projectsByPerson = new Map<string, Set<string>>();
  const uniquePersonIds = Array.from(new Set(personIds));
  for (const batch of chunk(uniquePersonIds, ID_FILTER_CHUNK_SIZE)) {
    const { data, error } = await db
      .from("project_people")
      .select("person_id, project_id")
      .in("person_id", batch)
      .eq("is_current", true);
    if (error) throw error;
    for (const row of data ?? []) {
      const set = projectsByPerson.get(row.person_id as string) ?? new Set<string>();
      set.add(row.project_id as string);
      projectsByPerson.set(row.person_id as string, set);
    }
  }
  for (const [personId, projectIds] of projectsByPerson) {
    if (projectIds.size === 1) result.set(personId, Array.from(projectIds)[0]);
  }
  return result;
}

// project_ids currently attached to an account, for HubSpot's account-level
// deal_owner signal to fan out across (HubSpot has no native project concept).
export async function fetchCurrentProjectIdsByAccountId(
  db: SupabaseClient,
  accountIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (accountIds.length === 0) return map;
  for (const batch of chunk(accountIds, ID_FILTER_CHUNK_SIZE)) {
    const { data, error } = await db.from("projects").select("id, account_id").in("account_id", batch);
    if (error) throw error;
    for (const row of data ?? []) {
      const list = map.get(row.account_id as string) ?? [];
      list.push(row.id as string);
      map.set(row.account_id as string, list);
    }
  }
  return map;
}
