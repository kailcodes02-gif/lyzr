"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { daysSince, getGoingDarkBucket, worstBucket, type GoingDarkBucket } from "@/lib/going-dark";

type PersonStub = { full_name: string | null; email: string | null };

export type AccountRow = {
  id: string;
  canonical_name: string;
  primary_domain: string | null;
  is_customer: boolean;
  status: string;
  lifecycle_stage: string | null;
  product_engaged: string[];
  product_links: Array<{ label: string; url: string }>;
  productOwners: PersonStub[];
  dealOwners: PersonStub[];
  last_contact_at: string | null;
  total_emails: number;
  goingDarkBucket: GoingDarkBucket;
};

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<AccountRow[]> => {
      const supabase = createClient();

      const [
        { data: accounts, error: accErr },
        { data: ownerRows, error: ownErr },
        { data: lastContact, error: lcErr },
        { data: staleness, error: stErr },
      ] = await Promise.all([
        supabase
          .from("accounts")
          .select(
            "id, canonical_name, primary_domain, is_customer, status, lifecycle_stage, product_engaged, product_links"
          ),
        // account_people_rollup is a view (project_people rolled up to
        // account level) -- PostgREST can't embed `people(...)` through a
        // view the way it does through a real FK-bearing table, so people
        // are fetched separately below and joined client-side.
        supabase
          .from("account_people_rollup")
          .select("account_id, role_key, person_id")
          .in("role_key", ["product_owner", "deal_owner"])
          .eq("is_current", true),
        supabase.from("account_last_contact").select("account_id, last_contact_at, total_emails"),
        supabase.from("project_staleness").select("account_id, last_contact_at"),
      ]);

      if (accErr) throw accErr;
      if (ownErr) throw ownErr;
      if (lcErr) throw lcErr;
      if (stErr) throw stErr;

      const personIds = Array.from(new Set((ownerRows ?? []).map((r) => r.person_id).filter(Boolean)));
      const { data: peopleRows, error: peopleErr } =
        personIds.length > 0
          ? await supabase.from("people").select("id, full_name, email").in("id", personIds)
          : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }>, error: null };
      if (peopleErr) throw peopleErr;
      const peopleById = new Map((peopleRows ?? []).map((p) => [p.id, { full_name: p.full_name, email: p.email }]));

      const productOwnersByAccount = new Map<string, PersonStub[]>();
      const dealOwnersByAccount = new Map<string, PersonStub[]>();
      for (const row of ownerRows ?? []) {
        const person = peopleById.get(row.person_id as string);
        if (!person) continue;
        const map = row.role_key === "deal_owner" ? dealOwnersByAccount : productOwnersByAccount;
        const list = map.get(row.account_id as string) ?? [];
        list.push(person);
        map.set(row.account_id as string, list);
      }
      const contactByAccount = new Map((lastContact ?? []).map((r) => [r.account_id, r]));

      // Worst-project going-dark bucket per account. Accounts with no
      // projects synced yet fall back to the flat account_last_contact
      // number so the tracker doesn't regress to "never" for everyone
      // before Cortex sync has run against the new schema.
      const projectBucketsByAccount = new Map<string, GoingDarkBucket[]>();
      for (const row of staleness ?? []) {
        const bucket = getGoingDarkBucket(daysSince(row.last_contact_at));
        const list = projectBucketsByAccount.get(row.account_id as string) ?? [];
        list.push(bucket);
        projectBucketsByAccount.set(row.account_id as string, list);
      }

      return (accounts ?? [])
        .map((a) => {
          const contact = contactByAccount.get(a.id);
          const projectBuckets = projectBucketsByAccount.get(a.id);
          const goingDarkBucket = projectBuckets
            ? worstBucket(projectBuckets)
            : getGoingDarkBucket(daysSince(contact?.last_contact_at ?? null));
          return {
            ...a,
            product_engaged: (a.product_engaged as string[]) ?? [],
            product_links: (a.product_links as Array<{ label: string; url: string }>) ?? [],
            productOwners: productOwnersByAccount.get(a.id) ?? [],
            dealOwners: dealOwnersByAccount.get(a.id) ?? [],
            last_contact_at: contact?.last_contact_at ?? null,
            total_emails: contact?.total_emails ?? 0,
            goingDarkBucket,
          };
        })
        .sort((a, b) => {
          if (b.goingDarkBucket !== a.goingDarkBucket) return b.goingDarkBucket - a.goingDarkBucket;
          // Nulls (never contacted) sort first — the worst offenders.
          if (!a.last_contact_at && !b.last_contact_at) return a.canonical_name.localeCompare(b.canonical_name);
          if (!a.last_contact_at) return -1;
          if (!b.last_contact_at) return 1;
          return a.last_contact_at.localeCompare(b.last_contact_at);
        });
    },
  });
}

// relationship_role carries either a client-POC role or, for rows sourced
// from project_people's role_key side, the role_key itself re-used in this
// slot so existing UI (keyed on `relationship_role`) doesn't need a second
// discriminant -- role_label carries the admin-editable display label for
// those rows (null for plain client-POC rows, which already have a fixed label).
export type ProjectListRow = {
  id: string;
  name: string;
  status: string;
  last_contact_at: string | null;
  goingDarkBucket: GoingDarkBucket;
};

export function useAccountProjects(accountId: string | null) {
  return useQuery({
    queryKey: ["account-projects", accountId],
    enabled: Boolean(accountId),
    queryFn: async (): Promise<ProjectListRow[]> => {
      const supabase = createClient();
      const [{ data: projects, error: projErr }, { data: staleness, error: stErr }] = await Promise.all([
        supabase.from("projects").select("id, name, status").eq("account_id", accountId!).order("name"),
        supabase.from("project_staleness").select("project_id, last_contact_at").eq("account_id", accountId!),
      ]);
      if (projErr) throw projErr;
      if (stErr) throw stErr;

      const lastContactByProject = new Map((staleness ?? []).map((s) => [s.project_id, s.last_contact_at]));
      return (projects ?? []).map((p) => {
        const lastContactAt = lastContactByProject.get(p.id) ?? null;
        return { ...p, last_contact_at: lastContactAt, goingDarkBucket: getGoingDarkBucket(daysSince(lastContactAt)) };
      });
    },
  });
}

export type AccountPersonRow = {
  relationship_role: string;
  role_label: string | null;
  is_current: boolean;
  people: { id: string; full_name: string | null; email: string | null; person_type: string; role_title: string | null } | null;
};

export type CommunicationEventRow = {
  id: string;
  sent_at: string;
  subject: string | null;
  snippet: string | null;
  ai_summary: string | null;
  sender_email: string | null;
  recipient_email: string;
  person_id: string | null;
  source_system: string;
  match_status: string;
};

export function useAccountDetail(accountId: string | null) {
  return useQuery({
    queryKey: ["account-detail", accountId],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const supabase = createClient();
      const [
        { data: account, error: accErr },
        { data: legacyAccountPeople, error: legacyErr },
        { data: projects, error: projErr },
        { data: roles, error: rolesErr },
        { data: events, error: evErr },
      ] = await Promise.all([
        supabase.from("accounts").select("*").eq("id", accountId!).single(),
        // HubSpot contacts have no project association, so its generic
        // client_poc_other rows still live at the account level.
        supabase
          .from("account_people")
          .select("relationship_role, is_current, people(id, full_name, email, person_type, role_title)")
          .eq("account_id", accountId!),
        supabase.from("projects").select("id").eq("account_id", accountId!),
        supabase.from("roles").select("key, label"),
        supabase
          .from("communication_events")
          .select(
            "id, sent_at, subject, snippet, ai_summary, sender_email, recipient_email, person_id, source_system, match_status"
          )
          .eq("account_id", accountId!)
          .order("sent_at", { ascending: false })
          .limit(200),
      ]);
      if (accErr) throw accErr;
      if (legacyErr) throw legacyErr;
      if (projErr) throw projErr;
      if (rolesErr) throw rolesErr;
      if (evErr) throw evErr;

      const projectIds = (projects ?? []).map((p) => p.id as string);
      const { data: projectPeople, error: ppErr } =
        projectIds.length > 0
          ? await supabase
              .from("project_people")
              .select("role_key, relationship_role, is_current, people(id, full_name, email, person_type, role_title)")
              .eq("is_current", true)
              .in("project_id", projectIds)
          : { data: [] as unknown[], error: null };
      if (ppErr) throw ppErr;

      const roleLabelByKey = new Map((roles ?? []).map((r) => [r.key as string, r.label as string]));

      const eventRows = (events ?? []) as CommunicationEventRow[];
      // Last 2 emails per contact — events are already sorted sent_at desc,
      // so the first 2 hits per person_id are its most recent.
      const lastTwoByPersonId = new Map<string, CommunicationEventRow[]>();
      for (const e of eventRows) {
        if (!e.person_id) continue;
        const list = lastTwoByPersonId.get(e.person_id) ?? [];
        if (list.length < 2) {
          list.push(e);
          lastTwoByPersonId.set(e.person_id, list);
        }
      }

      // project_people rows rolled up to account level for display -- this
      // account-detail page shows one combined view across all the
      // account's projects; a true per-project breakdown lives on the
      // project detail page.
      type RawProjectPerson = {
        role_key: string | null;
        relationship_role: string | null;
        is_current: boolean;
        people: AccountPersonRow["people"];
      };
      const projectPersonRows: AccountPersonRow[] = ((projectPeople ?? []) as unknown as RawProjectPerson[])
        .filter((r) => r.people)
        .map((r) => ({
          relationship_role: (r.role_key ?? r.relationship_role) as string,
          role_label: r.role_key ? (roleLabelByKey.get(r.role_key) ?? r.role_key) : null,
          is_current: r.is_current,
          people: r.people,
        }));

      const legacyRows = ((legacyAccountPeople ?? []) as unknown as Array<Omit<AccountPersonRow, "role_label">>).map(
        (r) => ({ ...r, role_label: null })
      );

      // Dedupe by (person, role) — the same person can legitimately surface
      // from both project_people (e.g. deal_owner fanned across projects)
      // and the legacy account_people table without this collapsing them
      // into repeated rows in the UI.
      const seen = new Set<string>();
      const peopleRows: AccountPersonRow[] = [];
      for (const row of [...projectPersonRows, ...legacyRows]) {
        const key = `${row.relationship_role}:${row.people?.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        peopleRows.push(row);
      }

      const lyzrPocs = peopleRows.filter((p) =>
        ["product_owner", "deal_owner", "project_owner"].includes(p.relationship_role)
      );
      const clientPocs = peopleRows.filter((p) => p.relationship_role.startsWith("client_poc"));

      return {
        account,
        people: peopleRows,
        lyzrPocs,
        clientPocs,
        events: eventRows,
        lastTwoByPersonId,
      };
    },
  });
}
