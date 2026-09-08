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
import { daysSince } from "@/lib/going-dark";
import { GoingDarkPill } from "@/components/ui/going-dark-pill";
import { EmptyState, ErrorNote, LoadingRows, PageHeader } from "@/components/ui/page";

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

  if (!id) return <EmptyState title="No project selected" action={<Link href="/"><Button variant="outline">Back to tracker</Button></Link>} />;
  if (isLoading) return <LoadingRows rows={6} />;
  if (error) return <ErrorNote error={error} />;
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
    <div className="space-y-6">
      <Link href={`/accounts?id=${project.account_id}`} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-3.5" /> Back to {account.canonical_name}
      </Link>

      <PageHeader
        title={project.name}
        description={`${account.canonical_name} · ${project.status}`}
        actions={
          <>
            <GoingDarkPill bucket={goingDarkBucket} days={d} />
            <Button size="sm" onClick={() => setSendOpen(true)} disabled={clientPocs.length === 0} title={clientPocs.length === 0 ? "No client contact on this project yet" : "Suggest topics, draft, and open your mail client"}>
              <Sparkles /> Generate &amp; Send
            </Button>
          </>
        }
      />

      {account.product_engaged.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {account.product_engaged.map((p) => (
            <Badge key={p}>{p}</Badge>
          ))}
        </div>
      )}

      <div className="space-y-6">
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
          <div className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Unassigned:</span>
            {unfilledRoles.map((r) => (
              <Button
                key={r.key}
                variant="outline"
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
          <button onClick={() => setTimelineOpen((o) => !o)} className="flex items-center gap-1.5 text-sm font-semibold cursor-pointer">
            {timelineOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            Project email timeline <span className="text-muted-foreground font-normal">({events.length})</span>
          </button>
          {timelineOpen && (
            <div className="mt-2 rounded-xl border bg-card shadow-xs divide-y divide-border max-h-[500px] overflow-y-auto">
              {events.length === 0 && <div className="p-3 text-sm text-muted-foreground">No emails synced yet.</div>}
              {events.map((e) => (
                <div key={e.id} className="p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground truncate">{e.subject ?? "(no subject)"}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{new Date(e.sent_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <SourceBadge source={e.source_system} />
                    <span className="text-xs text-muted-foreground">
                      {e.sender_email ? `from ${e.sender_email} ` : ""}to {e.recipient_email}
                    </span>
                    {e.match_status !== "matched" && <Badge color="amber">{e.match_status}</Badge>}
                  </div>
                  {(e.ai_summary || e.snippet) && (
                    <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{e.ai_summary ?? e.snippet}</p>
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
    <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
      <ProjectDetailContent />
    </Suspense>
  );
}
