"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ListPlus, ExternalLink, ChevronDown, ChevronRight, FolderKanban } from "lucide-react";
import { useAccountDetail, useAccountProjects } from "@/lib/hooks/use-data";
import { Badge, SourceBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { CreateTaskModal } from "@/components/tasks/create-task-modal";
import { PocGroup } from "@/components/accounts/poc-group";
import { goingDarkClassName, goingDarkLabel, daysSince } from "@/lib/going-dark";
import { cn } from "@/lib/utils";

function ProjectsSection({ accountId }: { accountId: string }) {
  const { data: projects, isLoading } = useAccountProjects(accountId);
  if (isLoading) return null;
  if (!projects || projects.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-medium text-zinc-900 mb-2 flex items-center gap-1.5">
        Projects <span className="text-xs text-zinc-400 font-normal">({projects.length})</span>
        <InfoTip>
          One row per Cortex project under this account. Open a project to see its own stakeholders and to Generate
          &amp; Send an update email scoped to just that project.
        </InfoTip>
      </h2>
      <div className="rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100">
        {projects.map((p) => {
          const d = daysSince(p.last_contact_at);
          return (
            <Link
              key={p.id}
              href={`/projects?id=${p.id}`}
              className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-zinc-50"
            >
              <FolderKanban className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span className="font-medium text-zinc-900 flex-1 truncate">{p.name}</span>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                  goingDarkClassName(p.goingDarkBucket)
                )}
              >
                {goingDarkLabel(d)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function AccountDetailContent() {
  const id = useSearchParams().get("id");
  const { data, isLoading, error } = useAccountDetail(id);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);

  if (!id) return <div className="text-sm text-zinc-500">No account selected.</div>;
  if (isLoading) return <div className="text-sm text-zinc-400">Loading…</div>;
  if (error) return <div className="text-sm text-red-600">{(error as Error).message}</div>;
  if (!data) return null;

  const { account, lyzrPocs, clientPocs, events, lastTwoByPersonId } = data;
  const productLinks = (account.product_links as Array<{ label: string; url: string }>) ?? [];

  return (
    <div className="max-w-4xl">
      <Link href="/" className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:underline">
        <ArrowLeft className="w-3 h-3" /> Back to tracker
      </Link>

      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">{account.canonical_name}</h1>
          <p className="text-sm text-zinc-500">
            {account.primary_domain ?? "no domain"} · {account.lifecycle_stage ?? "no lifecycle stage"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge color={account.is_customer ? "emerald" : "zinc"}>
            {account.is_customer ? "Customer" : account.status}
          </Badge>
          <Button variant="primary" size="sm" onClick={() => setTaskModalOpen(true)} className="rounded-full">
            <ListPlus className="w-3.5 h-3.5" /> Task
          </Button>
        </div>
      </div>

      {(account.product_engaged?.length > 0 || productLinks.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {(account.product_engaged as string[]).map((p) => (
            <Badge key={p} color="zinc">
              {p}
            </Badge>
          ))}
          {productLinks.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              {link.label} <ExternalLink className="w-3 h-3" />
            </a>
          ))}
        </div>
      )}

      <div className="mt-6 space-y-6">
        <ProjectsSection accountId={account.id} />
        <PocGroup
          title="Lyzr POCs"
          tip="Who at Lyzr is responsible for this account — the Product Owner comes from Cortex (project manager), the Deal Owner from HubSpot (assigned sales rep)."
          people={lyzrPocs}
          lastTwoByPersonId={lastTwoByPersonId}
        />
        <PocGroup
          title="Client POCs"
          tip="The client's own contacts, from Cortex project sponsors/contacts and HubSpot contacts associated with this company's deals. Click a row to see their 2 most recent emails."
          people={clientPocs}
          lastTwoByPersonId={lastTwoByPersonId}
        />

        <div>
          <button
            onClick={() => setTimelineOpen((o) => !o)}
            className="flex items-center gap-1.5 text-sm font-medium text-zinc-900"
          >
            {timelineOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Full account email timeline ({events.length})
            <InfoTip>Every synced email for this account, in one list — mostly useful for spot-checking; the per-contact view above is usually enough.</InfoTip>
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

      <CreateTaskModal open={taskModalOpen} onClose={() => setTaskModalOpen(false)} defaultAccountId={account.id} />
    </div>
  );
}

export default function AccountDetailPage() {
  return (
    <Suspense fallback={<div className="text-sm text-zinc-400">Loading…</div>}>
      <AccountDetailContent />
    </Suspense>
  );
}
