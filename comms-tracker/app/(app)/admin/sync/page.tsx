"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, RefreshCw } from "lucide-react";
import { useSyncState } from "@/lib/hooks/use-sync";
import { connectGoogle, connectMicrosoft, GMAIL_SCOPE, useMailboxConnections } from "@/lib/hooks/use-drive-connect";
import { createClient } from "@/lib/supabase/client";
import { Badge, SourceBadge, type BadgeColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";

const STATUS_COLOR: Record<string, BadgeColor> = {
  success: "emerald",
  partial: "amber",
  failed: "red",
  running: "blue",
};

const SOURCES = ["cortex", "hubspot", "instantly"] as const;
const KNOWLEDGE_SOURCES = ["lyzr_blog", "slack", "drive", "onedrive", "internal_email"] as const;
const MAIL_PROVIDERS = [
  { key: "gmail", label: "Gmail", provider: "google" as const },
  { key: "outlook", label: "Outlook", provider: "microsoft" as const },
] as const;

function SyncAdminContent() {
  const { data, isLoading } = useSyncState();
  const { data: mailboxes } = useMailboxConnections();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [refreshing, setRefreshing] = useState<string | null>(null);

  // The Outlook connect round-trip lands back here via the Worker's
  // callback redirect with ?connected=outlook or ?connect_error=...
  useEffect(() => {
    const connected = searchParams.get("connected");
    const connectError = searchParams.get("connect_error");
    if (connected === "outlook") {
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

  async function refresh(source: string, base: "sync" | "knowledge/sync" | "mail/sync" = "sync") {
    setRefreshing(source);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");

      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/${base}/${source}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body}`);
      }
      toast.success(`${source} sync triggered`);
      queryClient.invalidateQueries({ queryKey: ["sync-state"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-connections"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(null);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 flex items-center gap-1.5">
            Sync Admin
            <InfoTip>
              Cortex pulls accounts + Lyzr owners + client contacts. HubSpot pulls customer/deal status + deal owners
              for those accounts. Instantly pulls emails from ABM-tagged campaigns, matched to known accounts/people.
            </InfoTip>
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Everything below also runs automatically every Sunday 03:00 UTC (Worker cron); a refresh here triggers the
            same code path on demand.
          </p>
        </div>
        <Button variant="primary" onClick={() => refresh("all")} disabled={refreshing !== null} className="rounded-full">
          <RefreshCw className={refreshing === "all" ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
          {refreshing === "all" ? "Refreshing…" : "Refresh all"}
        </Button>
      </div>

      {isLoading && <div className="mt-6 text-sm text-zinc-400">Loading…</div>}

      {data && (
        <>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {SOURCES.map((source) => {
              const s = data.state.find((r) => r.source_key === source);
              return (
                <div key={source} className="rounded-lg border border-zinc-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <SourceBadge source={source} />
                    <button
                      onClick={() => refresh(source)}
                      disabled={refreshing !== null}
                      className="text-xs text-zinc-500 hover:text-zinc-900 disabled:opacity-50"
                    >
                      {refreshing === source ? "…" : "Refresh"}
                    </button>
                  </div>
                  <div className="text-xs text-zinc-500 mt-2">
                    {s?.last_synced_at ? `Last synced ${new Date(s.last_synced_at).toLocaleString()}` : "Never synced"}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-900 flex items-center gap-1.5">
              Mailboxes
              <InfoTip>
                Connect your own Gmail (lyzr.ai) and Outlook (lyzr.com) so the tracker can see emails you exchange
                with client contacts from your personal inbox, confirm the &quot;sent via app&quot; rows, and collect
                emails from siva@lyzr.ai / siva@lyzr.com for the knowledge base. Read-only. Only mail touching a
                tracked account or contact is stored.
              </InfoTip>
            </h2>
            <Button variant="secondary" onClick={() => refresh("all", "mail/sync")} disabled={refreshing !== null}>
              <RefreshCw className={refreshing === "all" ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
              Read mailboxes
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {MAIL_PROVIDERS.map(({ key, label, provider }) => {
              const conn = mailboxes?.[provider];
              const hasMailScope = provider === "microsoft" ? Boolean(conn?.connected) : Boolean(conn?.scopes.includes(GMAIL_SCOPE));
              const s = data.state.find((r) => r.source_key === key);
              return (
                <div key={key} className="rounded-lg border border-zinc-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-700 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-zinc-400" /> {label}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={hasMailScope ? "secondary" : "primary"}
                        size="sm"
                        onClick={() => handleConnect(provider)}
                      >
                        {hasMailScope ? "Reconnect" : conn?.connected ? `Grant ${label} access` : `Connect ${label}`}
                      </Button>
                      <button
                        onClick={() => refresh(key, "mail/sync")}
                        disabled={refreshing !== null || !hasMailScope}
                        className="text-xs text-zinc-500 hover:text-zinc-900 disabled:opacity-50"
                      >
                        {refreshing === key ? "…" : "Refresh"}
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-500 mt-2">
                    {hasMailScope
                      ? `Connected as ${conn?.accountEmail ?? "you"}`
                      : conn?.connected
                        ? "Connected for Drive only — reconnect to add Gmail"
                        : "Not connected"}
                    {" · "}
                    {s?.last_synced_at ? `last read ${new Date(s.last_synced_at).toLocaleString()}` : "never read"}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-900 flex items-center gap-1.5">
              Knowledge base
              <InfoTip>
                Weekly-refreshed sources feeding the topic-suggestion + draft engine: lyzr.ai blog/case studies,
                Slack channels, connected Google Drives, OneDrive/SharePoint files (via the Outlook connection), and internal emails from siva@ collected via the mailboxes above.
              </InfoTip>
            </h2>
            <Button
              variant="secondary"
              onClick={() => refresh("all", "knowledge/sync")}
              disabled={refreshing !== null}
            >
              <RefreshCw className={refreshing === "all" ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
              Refresh knowledge
            </Button>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {mailboxes?.google.connected
              ? `Drive connected as ${mailboxes.google.accountEmail ?? "you"} — the knowledge base only sees what your own Google account can see.`
              : "Drive uses the same Google connection as Gmail above — click Connect Gmail to enable both."}
            {" "}onedrive reads OneDrive + SharePoint through your Outlook connection; internal_email is filled by the mailbox reads (emails from siva@lyzr.ai / siva@lyzr.com).
          </p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-5 gap-3">
            {KNOWLEDGE_SOURCES.map((source) => {
              const s = data.state.find((r) => r.source_key === source);
              return (
                <div key={source} className="rounded-lg border border-zinc-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-700">{source}</span>
                    <button
                      onClick={() => refresh(source, "knowledge/sync")}
                      disabled={refreshing !== null}
                      className="text-xs text-zinc-500 hover:text-zinc-900 disabled:opacity-50"
                    >
                      {refreshing === source ? "…" : "Refresh"}
                    </button>
                  </div>
                  <div className="text-xs text-zinc-500 mt-2">
                    {s?.last_synced_at ? `Last synced ${new Date(s.last_synced_at).toLocaleString()}` : "Never synced"}
                  </div>
                </div>
              );
            })}
          </div>

          <h2 className="mt-8 text-sm font-medium text-zinc-900">Recent runs</h2>
          <div className="mt-2 rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100 max-h-[500px] overflow-y-auto">
            {data.runs.length === 0 && <div className="p-3 text-sm text-zinc-400">No sync runs yet.</div>}
            {data.runs.map((run) => (
              <div key={run.id} className="p-3 text-sm flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <SourceBadge source={run.source_system} />
                    <span className="text-zinc-400 text-xs">{run.run_type}</span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {new Date(run.started_at).toLocaleString()}
                    {run.records_fetched != null &&
                      ` · fetched ${run.records_fetched}, upserted ${run.records_upserted}, flagged ${run.records_flagged_for_review}`}
                  </div>
                  {run.error_message && <div className="text-xs text-red-600 mt-1">{run.error_message}</div>}
                </div>
                <Badge color={STATUS_COLOR[run.status] ?? "zinc"}>{run.status}</Badge>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function SyncAdminPage() {
  return (
    <Suspense fallback={<div className="text-sm text-zinc-400">Loading…</div>}>
      <SyncAdminContent />
    </Suspense>
  );
}
