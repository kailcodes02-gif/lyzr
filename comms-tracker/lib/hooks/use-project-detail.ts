"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { daysSince, getGoingDarkBucket, type GoingDarkBucket } from "@/lib/going-dark";
import type { AccountPersonRow, CommunicationEventRow } from "./use-data";

export type ProjectDetail = {
  project: { id: string; name: string; status: string; account_id: string };
  account: { canonical_name: string; product_engaged: string[] };
  lyzrPocs: AccountPersonRow[];
  clientPocs: AccountPersonRow[];
  events: CommunicationEventRow[];
  lastTwoByPersonId: Map<string, CommunicationEventRow[]>;
  lastContactAt: string | null;
  goingDarkBucket: GoingDarkBucket;
};

// Project-scoped sibling of useAccountDetail in use-data.ts -- same shape,
// but everything is filtered to ONE project_id instead of rolled up across
// an account's projects, since project_people/communication_events are real
// FK-bearing tables PostgREST can embed `people(...)` through directly.
export function useProjectDetail(projectId: string | null) {
  return useQuery({
    queryKey: ["project-detail", projectId],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ProjectDetail> => {
      const supabase = createClient();
      const [
        { data: project, error: projErr },
        { data: projectPeople, error: ppErr },
        { data: roles, error: rolesErr },
        { data: events, error: evErr },
        { data: staleness, error: stErr },
      ] = await Promise.all([
        supabase.from("projects").select("id, name, status, account_id, accounts(canonical_name, product_engaged)").eq("id", projectId!).single(),
        supabase
          .from("project_people")
          .select("role_key, relationship_role, is_current, people(id, full_name, email, person_type, role_title)")
          .eq("project_id", projectId!)
          .eq("is_current", true),
        supabase.from("roles").select("key, label"),
        supabase
          .from("communication_events")
          .select("id, sent_at, subject, snippet, ai_summary, sender_email, recipient_email, person_id, source_system, match_status")
          .eq("project_id", projectId!)
          .order("sent_at", { ascending: false })
          .limit(200),
        supabase.from("project_staleness").select("last_contact_at").eq("project_id", projectId!).maybeSingle(),
      ]);
      if (projErr) throw projErr;
      if (ppErr) throw ppErr;
      if (rolesErr) throw rolesErr;
      if (evErr) throw evErr;
      if (stErr) throw stErr;

      const roleLabelByKey = new Map((roles ?? []).map((r) => [r.key as string, r.label as string]));
      const eventRows = (events ?? []) as CommunicationEventRow[];

      const lastTwoByPersonId = new Map<string, CommunicationEventRow[]>();
      for (const e of eventRows) {
        if (!e.person_id) continue;
        const list = lastTwoByPersonId.get(e.person_id) ?? [];
        if (list.length < 2) {
          list.push(e);
          lastTwoByPersonId.set(e.person_id, list);
        }
      }

      type RawProjectPerson = {
        role_key: string | null;
        relationship_role: string | null;
        is_current: boolean;
        people: AccountPersonRow["people"];
      };
      const peopleRows: AccountPersonRow[] = ((projectPeople ?? []) as unknown as RawProjectPerson[])
        .filter((r) => r.people)
        .map((r) => ({
          relationship_role: (r.role_key ?? r.relationship_role) as string,
          role_label: r.role_key ? (roleLabelByKey.get(r.role_key) ?? r.role_key) : null,
          is_current: r.is_current,
          people: r.people,
        }));

      const lyzrPocs = peopleRows.filter((p) =>
        ["product_owner", "deal_owner", "project_owner"].includes(p.relationship_role)
      );
      const clientPocs = peopleRows.filter((p) => p.relationship_role.startsWith("client_poc"));

      const account = project.accounts as unknown as { canonical_name: string; product_engaged: string[] } | null;
      const lastContactAt = staleness?.last_contact_at ?? null;

      return {
        project: { id: project.id, name: project.name, status: project.status, account_id: project.account_id },
        account: { canonical_name: account?.canonical_name ?? "", product_engaged: (account?.product_engaged as string[]) ?? [] },
        lyzrPocs,
        clientPocs,
        events: eventRows,
        lastTwoByPersonId,
        lastContactAt,
        goingDarkBucket: getGoingDarkBucket(daysSince(lastContactAt)),
      };
    },
  });
}

// Admin-only manual override of one of the three configurable owner roles on
// this project -- writes a project_people row with is_manual_override=true,
// which upsertProjectOwnerRoles (lib/sync/projects.ts) then treats as
// locked for that (project, role) pair on every future sync.
export function useReassignProjectRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { projectId: string; personId: string; roleKey: string }) => {
      const supabase = createClient();
      // Retire whoever currently holds this role on this project first --
      // otherwise the old auto-synced holder keeps showing alongside the
      // new one forever, since a locked (project, role) pair is skipped
      // entirely on future syncs rather than cleaned up.
      const { error: retireErr } = await supabase
        .from("project_people")
        .update({ is_current: false, ended_at: new Date().toISOString() })
        .eq("project_id", input.projectId)
        .eq("role_key", input.roleKey)
        .eq("is_current", true);
      if (retireErr) throw retireErr;

      const { error } = await supabase.from("project_people").upsert(
        {
          project_id: input.projectId,
          person_id: input.personId,
          role_key: input.roleKey,
          relationship_role: null,
          source_system: "manual",
          is_manual_override: true,
          is_current: true,
          ended_at: null,
        },
        { onConflict: "project_id,person_id,role_key" }
      );
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["project-detail", variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}
