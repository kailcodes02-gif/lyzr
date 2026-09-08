"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, RefreshCw, Plug, BookOpen, Database } from "lucide-react";
import { useSyncState } from "@/lib/hooks/use-sync";
import { connectGoogle, connectMicrosoft, GMAIL_SCOPE, useMailboxConnections } from "@/lib/hooks/use-drive-connect";
import { createClient } from "@/lib/supabase/client";
import { Badge, SourceBadge, sourceLabel, type BadgeColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, LoadingRows, PageHeader, SectionHeading } from "@/components/ui/page";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<string, BadgeColor> = { success: "emerald", partial: "amber", failed: "red", running: "blue" };

const SOURCES = [
  { key: "cortex", label: "Cortex", desc: "Accounts, projects, Lyzr owners, client contacts" },
  { key: "hubspot", label: "HubSpot", desc: "Customer status, deal owners, contacts, email activity" },
  { key: "instantly", label: "Instantly", desc: "Emails sent from ABM campaigns (read-only)" },
] as const;

const KNOWLEDGE_SOURCES = [
  { key: "lyzr_blog", label: "lyzr.ai blog & case studies", desc: "Scraped weekly, summarized" },
  { key: "slack", label: "Slack", desc: "Channels the ABM bot is in" },
  { key: "drive", label: "Google Drive", desc: "Docs, Sheets, Slides you can open; Gemini meeting notes are filed as Meeting notes" },
  { key: "onedrive", label: "OneDrive & SharePoint", desc: "Office files you can open" },
  { key: "internal_email", label: "Internal email", desc: "Emails from siva@lyzr.ai / .com" },
] as const;

const MAIL_PROVIDERS = [
  { key: "gmail", label: "Gmail", provider: "google" as const, hint: "your @lyzr.ai inbox" },
  { key: "outlook", label: "Outlook", provider: "microsoft" as const, hint: "your @lyzr.com inbox" },
] as const;

function LastRun({ at, verb = "Last synced" }: { at: string | null | undefined; verb?: string }) {
  return <span className="text-muted-foreground text-xs">{at ? `${verb} ${new Date(at).toLocaleString()}` : "Never run"}</span>;
}

function RefreshButton({ onClick, busy, disabled, label = "Refresh" }: { onClick: () => void; busy: boolean; disabled?: boolean; label?: string }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled || busy}>
      <RefreshCw className={cn(busy && "animate-spin")} /> {busy ? "Queued…" : label}
    </Button>
  );
}

function SyncAdminContent() {
  const { data, isLoading } = useSyncState();
  const { data: mailboxes } = useMailboxConnections();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [refreshing, setRefreshing] = useState<string | null>(null);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const connectError = searchParams.get("connect_error");
    if (searchParams.get("admin_consent") === "granted") {
      toast.success("Microsoft admin consent granted for the whole tenant. Everyone can now click Connect Outlook.");
    } else if (connected === "outlook") {
      toast.success(`Outlook connected${searchParams.get("email") ? ` as ${searchParams.get("email")}` : ""}`);
      queryClient.invalidateQueries({ queryKey: ["mailbox-connections"] });
    } else if (connectError) {
      toast.error(`Outlook connection failed: ${connectError}`);
    }
  }, [searchParams, queryClient]);

  async function handleConnect(provider: "google" | "microsoft") {
    try {
      if (provider === "google") await connectGoogle();
      else await connectMicrosoft();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function refresh(target: string) {
    setRefreshing(target);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/refresh/${target}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const body = (await res.json().catch(() => ({}))) as { queued?: boolean };
      toast.success(body.queued ? `${target === "all" ? "Full" : sourceLabel(target)} refresh queued. Runs appear below within a minute.` : `${target} refresh finished`);
      queryClient.invalidateQueries({ queryKey: ["sync-state"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-connections"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(null);
    }
  }

  const stateFor = (key: string) => data?.state.find((r) => r.source_key === key);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Data & Sync"
        tip="Cortex pulls accounts, projects, owners and client contacts. HubSpot adds customer and deal status plus email activity. Instantly adds campaign sends. Mailboxes add what you send from your own inbox. Knowledge feeds the email suggestions."
        description="Everything refreshes automatically every day at 12:00 AM IST. Refresh all runs every source, mailbox, and knowledge feed on demand; expect a few minutes."
        actions={
          <Button onClick={() => refresh("all")} disabled={refreshing !== null}>
            <RefreshCw className={cn(refreshing === "all" && "animate-spin")} /> {refreshing === "all" ? "Queued…" : "Refresh all"}
          </Button>
        }
      />

      {isLoading && <LoadingRows />}

      {data && (
        <>
          <section className="space-y-3">
            <SectionHeading title={<span className="inline-flex items-center gap-1.5"><Database className="size-4" /> Sources</span>} actions={<RefreshButton onClick={() => refresh("sources")} busy={refreshing === "sources"} disabled={refreshing !== null} label="Refresh sources" />} />
            <div className="grid gap-3 sm:grid-cols-3">
              {SOURCES.map((s) => (
                <Card key={s.key} className="gap-3 py-4">
                  <CardHeader className="px-4">
                    <CardTitle className="flex items-center justify-between text-sm">
                      <SourceBadge source={s.key} />
                      <RefreshButton onClick={() => refresh(s.key)} busy={refreshing === s.key} disabled={refreshing !== null} />
                    </CardTitle>
                    <CardDescription className="text-xs">{s.desc}</CardDescription>
                  </CardHeader>
                  <CardContent className="px-4">
                    <LastRun at={stateFor(s.key)?.last_synced_at} />
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeading
              title={<span className="inline-flex items-center gap-1.5"><Mail className="size-4" /> Mailboxes</span>}
              tip="Connect your own Gmail (lyzr.ai) and Outlook (lyzr.com). Read-only. Only mail touching a tracked account or contact is stored; it also confirms your sent-via-app emails and collects siva@ emails for the knowledge base."
              actions={<RefreshButton onClick={() => refresh("mail")} busy={refreshing === "mail"} disabled={refreshing !== null} label="Read mailboxes" />}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {MAIL_PROVIDERS.map(({ key, label, provider, hint }) => {
                const conn = mailboxes?.[provider];
                const hasMailScope = provider === "microsoft" ? Boolean(conn?.connected) : Boolean(conn?.scopes.includes(GMAIL_SCOPE));
                return (
                  <Card key={key} className="gap-3 py-4">
                    <CardHeader className="px-4">
                      <CardTitle className="flex items-center justify-between text-sm">
                        <span className="inline-flex items-center gap-2">
                          <SourceBadge source={key} />
                          {hasMailScope ? <Badge color="emerald">Connected</Badge> : conn?.connected ? <Badge color="amber">Drive only</Badge> : <Badge>Not connected</Badge>}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Button variant={hasMailScope ? "outline" : "default"} size="sm" onClick={() => handleConnect(provider)}>
                            <Plug /> {hasMailScope ? "Reconnect" : `Connect ${label}`}
                          </Button>
                          <RefreshButton onClick={() => refresh(key)} busy={refreshing === key} disabled={refreshing !== null || !hasMailScope} label="Read" />
                        </span>
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {hasMailScope ? `Reading ${conn?.accountEmail ?? hint}` : conn?.connected ? "Connected for Drive only. Reconnect to add Gmail." : `Not connected (${hint})`}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="px-4">
                      <LastRun at={stateFor(key)?.last_synced_at} verb="Last read" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeading
              title={<span className="inline-flex items-center gap-1.5"><BookOpen className="size-4" /> Knowledge base</span>}
              tip="Daily-refreshed sources the topic-suggestion and draft engine ranks by recency. Drive uses your Gmail connection; OneDrive and SharePoint use your Outlook connection; internal email is filled by the mailbox reads."
              actions={<RefreshButton onClick={() => refresh("knowledge")} busy={refreshing === "knowledge"} disabled={refreshing !== null} label="Refresh knowledge" />}
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {KNOWLEDGE_SOURCES.map((s) => (
                <Card key={s.key} className="gap-3 py-4">
                  <CardHeader className="px-4">
                    <CardTitle className="flex items-center justify-between text-sm">
                      <span>{s.label}</span>
                      <RefreshButton onClick={() => refresh(s.key)} busy={refreshing === s.key} disabled={refreshing !== null} />
                    </CardTitle>
                    <CardDescription className="text-xs">{s.desc}</CardDescription>
                  </CardHeader>
                  <CardContent className="px-4">
                    <LastRun at={stateFor(s.key)?.last_synced_at} />
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeading title="Recent runs" tip="Every sync, mailbox read, and knowledge refresh, newest first, with what it fetched and any messages." />
            {data.runs.length === 0 ? (
              <EmptyState title="No runs yet" />
            ) : (
              <div className="bg-card max-h-[520px] divide-y overflow-y-auto rounded-xl border shadow-xs">
                {data.runs.map((run) => (
                  <div key={run.id} className="flex items-start justify-between gap-3 p-4 text-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <SourceBadge source={run.source_system} />
                        <span className="text-muted-foreground text-xs">{run.run_type}</span>
                        <span className="text-muted-foreground text-xs">{new Date(run.started_at).toLocaleString()}</span>
                      </div>
                      {run.records_fetched != null && (
                        <div className="text-muted-foreground mt-1 text-xs tabular-nums">
                          fetched {run.records_fetched} · stored {run.records_upserted} · flagged {run.records_flagged_for_review}
                        </div>
                      )}
                      {run.error_message && (
                        <pre className={cn("mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md px-2.5 py-1.5 font-sans text-xs", run.status === "failed" ? "bg-red-50 text-red-700" : "bg-muted text-muted-foreground")}>
                          {run.error_message}
                        </pre>
                      )}
                    </div>
                    <Badge color={STATUS_COLOR[run.status] ?? "zinc"}>{run.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default function SyncAdminPage() {
  return (
    <Suspense fallback={<LoadingRows />}>
      <SyncAdminContent />
    </Suspense>
  );
}
