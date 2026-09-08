"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ListPlus, ExternalLink, ChevronDown, ChevronRight, FolderKanban } from "lucide-react";
import { useAccountDetail, useAccountProjects } from "@/lib/hooks/use-data";
import { Badge, SourceBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorNote, LoadingRows, PageHeader, SectionHeading } from "@/components/ui/page";
import { CreateTaskModal } from "@/components/tasks/create-task-modal";
import { PocGroup } from "@/components/accounts/poc-group";
import { daysSince } from "@/lib/going-dark";
import { GoingDarkPill } from "@/components/ui/going-dark-pill";

function ProjectsSection({ accountId }: { accountId: string }) {
  const { data: projects, isLoading } = useAccountProjects(accountId);
  if (isLoading) return <LoadingRows rows={2} />;
  if (!projects || projects.length === 0) return null;

  return (
    <section className="space-y-2">
      <SectionHeading
        title="Projects"
        count={projects.length}
        tip="One row per Cortex project under this account. Open a project to see its own stakeholders and to Generate & Send an update email scoped to that project."
      />
      <div className="bg-card divide-y rounded-xl border shadow-xs">
        {projects.map((p) => (
          <Link key={p.id} href={`/projects?id=${p.id}`} className="hover:bg-muted/50 flex items-center gap-3 px-4 py-2.5 text-sm transition-colors">
            <FolderKanban className="text-muted-foreground size-4 shrink-0" />
            <span className="flex-1 truncate font-medium">{p.name}</span>
            <Badge>{p.status}</Badge>
            <GoingDarkPill bucket={p.goingDarkBucket} days={daysSince(p.last_contact_at)} />
            <ChevronRight className="text-muted-foreground size-4" />
          </Link>
        ))}
      </div>
    </section>
  );
}

function AccountDetailContent() {
  const id = useSearchParams().get("id");
  const { data, isLoading, error } = useAccountDetail(id);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);

  if (!id) return <EmptyState title="No account selected" action={<Link href="/"><Button variant="outline">Back to tracker</Button></Link>} />;
  if (isLoading) return <LoadingRows rows={6} />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;

  const { account, lyzrPocs, clientPocs, events, lastTwoByPersonId } = data;
  const productLinks = (account.product_links as Array<{ label: string; url: string }>) ?? [];

  return (
    <div className="space-y-6">
      <Link href="/" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-3.5" /> Back to tracker
      </Link>

      <PageHeader
        title={account.canonical_name}
        description={`${account.primary_domain ?? "no domain"} · ${account.lifecycle_stage ?? "no lifecycle stage"}`}
        actions={
          <>
            <Badge color={account.is_customer ? "emerald" : "zinc"}>{account.is_customer ? "Customer" : account.status}</Badge>
            <Button size="sm" onClick={() => setTaskModalOpen(true)}>
              <ListPlus /> New task
            </Button>
          </>
        }
      />

      {(account.product_engaged?.length > 0 || productLinks.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {(account.product_engaged as string[]).map((p) => (
            <Badge key={p}>{p}</Badge>
          ))}
          {productLinks.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
              <Badge color="blue" className="hover:bg-blue-100">
                {link.label} <ExternalLink />
              </Badge>
            </a>
          ))}
        </div>
      )}

      <ProjectsSection accountId={account.id} />
      <PocGroup
        title="Lyzr POCs"
        tip="Who at Lyzr is responsible for this account. Product Owner comes from Cortex (project manager), Deal Owner from HubSpot (assigned sales rep)."
        people={lyzrPocs}
        lastTwoByPersonId={lastTwoByPersonId}
      />
      <PocGroup
        title="Client POCs"
        tip="The client's own contacts, from Cortex project sponsors and HubSpot contacts on this company's deals. Click a row to see their two most recent emails."
        people={clientPocs}
        lastTwoByPersonId={lastTwoByPersonId}
      />

      <section className="space-y-2">
        <button onClick={() => setTimelineOpen((o) => !o)} className="flex items-center gap-1.5 text-sm font-semibold cursor-pointer">
          {timelineOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Full email timeline <span className="text-muted-foreground font-normal">({events.length})</span>
        </button>
        {timelineOpen && (
          <div className="bg-card max-h-[500px] divide-y overflow-y-auto rounded-xl border shadow-xs">
            {events.length === 0 && <div className="text-muted-foreground p-4 text-sm">No emails synced yet.</div>}
            {events.map((e) => (
              <div key={e.id} className="p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{e.subject ?? "(no subject)"}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">{new Date(e.sent_at).toLocaleDateString()}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <SourceBadge source={e.source_system} />
                  <span className="text-muted-foreground text-xs">
                    {e.sender_email ? `from ${e.sender_email} ` : ""}to {e.recipient_email}
                  </span>
                  {e.match_status !== "matched" && <Badge color="amber">{e.match_status}</Badge>}
                </div>
                {(e.ai_summary || e.snippet) && <p className="text-muted-foreground mt-1.5 line-clamp-2 text-xs">{e.ai_summary ?? e.snippet}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      <CreateTaskModal open={taskModalOpen} onClose={() => setTaskModalOpen(false)} defaultAccountId={account.id} />
    </div>
  );
}

export default function AccountDetailPage() {
  return (
    <Suspense fallback={<LoadingRows rows={6} />}>
      <AccountDetailContent />
    </Suspense>
  );
}
