"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight, Sparkles, UserCog } from "lucide-react";
import { useProjectDetail } from "@/lib/hooks/use-project-detail";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useRoles } from "@/lib/hooks/use-roles";
import { Badge, SourceBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PocGroup } from "@/components/accounts/poc-group";
import { GenerateSendModal } from "@/components/compose/generate-send-modal";
import { ReassignRoleModal } from "@/components/projects/reassign-role-modal";
import { goingDarkClassName, goingDarkLabel, daysSince } from "@/lib/going-dark";
import { cn } from "@/lib/utils";

function ProjectDetailContent() {
  const id = useSearchParams().get("id");
  const { data, isLoading, error } = useProjectDetail(id);
  const { data: currentUser } = useCurrentUser();
  const { data: roles } = useRoles();
  const [sendOpen, setSendOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  // Which owner role the admin is (re)assigning right now, if any.
  const [reassign, setReassign] = useState<{
    roleKey: string;
    roleLabel: string;
    personId: string | null;
    personName: string | null;
  } | null>(null);

  if (!id) return <div className="text-sm text-zinc-500">No project selected.</div>;
  if (isLoading) return <div className="text-sm text-zinc-400">Loading…</div>;
  if (error) return <div className="text-sm text-red-600">{(error as Error).message}</div>;
  if (!data) return null;

  const { project, account, lyzrPocs, clientPocs, events, lastTwoByPersonId, lastContactAt, goingDarkBucket } = data;
  const d = daysSince(lastContactAt);
  const isAdmin = currentUser?.role === "admin";
  // Active owner roles nobody currently holds on this project (typically
  // Project Owner, which is admin-assigned rather than synced) -- surfaced
  // as "Assign" buttons so an admin can fill them without leaving the page.
  const heldRoleKeys = new Set(lyzrPocs.map((p) => p.relationship_role));
  const unfilledRoles = (roles ?? []).filter((r) => r.is_active && !heldRoleKeys.has(r.key));

  return (
    <div className="max-w-4xl">
      <Link
        href={`/accounts?id=${project.account_id}`}
        className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:underline"
      >
        <ArrowLeft className="w-3 h-3" /> Back to {account.canonical_name}
      </Link>

      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">{project.name}</h1>
          <p className="text-sm text-zinc-500">
            {account.canonical_name} · {project.status}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
              goingDarkClassName(goingDarkBucket)
            )}
          >
            {goingDarkLabel(d)}
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setSendOpen(true)}
            className="rounded-full"
            disabled={clientPocs.length === 0}
          >
            <Sparkles className="w-3.5 h-3.5" /> Generate &amp; Send
          </Button>
        </div>
      </div>

      {account.product_engaged.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {account.product_engaged.map((p) => (
            <Badge key={p} color="zinc">
              {p}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-6 space-y-6">
        <PocGroup
          title="Lyzr POCs"
          tip="Who at Lyzr owns this project — Product Owner and Deal Owner auto-sync from Cortex/HubSpot, Project Owner is admin-assigned. Manage the role list at Admin → Roles."
          people={lyzrPocs}
          lastTwoByPersonId={lastTwoByPersonId}
          renderAction={
            isAdmin
              ? (p) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Reassign this role to a different Lyzr person"
                    onClick={() =>
                      setReassign({
                        roleKey: p.relationship_role,
                        roleLabel: p.role_label ?? p.relationship_role,
                        personId: p.people?.id ?? null,
                        personName: p.people?.full_name ?? p.people?.email ?? null,
                      })
                    }
                  >
                    <UserCog className="w-3.5 h-3.5" /> Reassign
                  </Button>
                )
              : undefined
          }
        />
        {isAdmin && unfilledRoles.length > 0 && (
          <div className="-mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>Unassigned:</span>
            {unfilledRoles.map((r) => (
              <Button
                key={r.key}
                variant="secondary"
                size="sm"
                onClick={() => setReassign({ roleKey: r.key, roleLabel: r.label, personId: null, personName: null })}
              >
                Assign {r.label}
              </Button>
            ))}
          </div>
        )}
        <PocGroup
          title="Client POCs"
          tip="This project's own client contacts, from Cortex sponsors/contacts. Click a row to see their 2 most recent emails."
          people={clientPocs}
          lastTwoByPersonId={lastTwoByPersonId}
        />

        <div>
          <button
            onClick={() => setTimelineOpen((o) => !o)}
            className="flex items-center gap-1.5 text-sm font-medium text-zinc-900"
          >
            {timelineOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Project email timeline ({events.length})
          </button>
          {timelineOpen && (
            <div className="mt-2 rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100 max-h-[500px] overflow-y-auto">
              {events.length === 0 && <div className="p-3 text-sm text-zinc-400">No emails synced yet.</div>}
              {events.map((e) => (
                <div key={e.id} className="p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900 truncate">{e.subject ?? "(no subject)"}</span>
                    <span className="text-xs text-zinc-400 shrink-0">{new Date(e.sent_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <SourceBadge source={e.source_system} />
                    <span className="text-xs text-zinc-500">
                      {e.sender_email ? `from ${e.sender_email} ` : ""}to {e.recipient_email}
                    </span>
                    {e.match_status !== "matched" && <Badge color="amber">{e.match_status}</Badge>}
                  </div>
                  {(e.ai_summary || e.snippet) && (
                    <p className="text-xs text-zinc-600 mt-1.5 line-clamp-2">{e.ai_summary ?? e.snippet}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <GenerateSendModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        accountId={project.account_id}
        projectId={project.id}
        projectName={project.name}
        accountName={account.canonical_name}
        clientPocs={clientPocs}
      />
      {reassign && (
        <ReassignRoleModal
          open
          onClose={() => setReassign(null)}
          projectId={project.id}
          roleKey={reassign.roleKey}
          roleLabel={reassign.roleLabel}
          currentPersonId={reassign.personId}
          currentPersonName={reassign.personName}
        />
      )}
    </div>
  );
}

export default function ProjectDetailPage() {
  return (
    <Suspense fallback={<div className="text-sm text-zinc-400">Loading…</div>}>
      <ProjectDetailContent />
    </Suspense>
  );
}
