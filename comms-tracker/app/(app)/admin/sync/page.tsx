"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { useSyncState } from "@/lib/hooks/use-sync";
import { connectGoogleDrive, useDriveConnection } from "@/lib/hooks/use-drive-connect";
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
const KNOWLEDGE_SOURCES = ["lyzr_blog", "slack", "drive", "internal_email"] as const;

export default function SyncAdminPage() {
  const { data, isLoading } = useSyncState();
  const { data: driveConnection } = useDriveConnection();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState<string | null>(null);

  async function handleConnectDrive() {
    try {
      await connectGoogleDrive();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function refresh(source: string, base: "sync" | "knowledge/sync" = "sync") {
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
            Nothing syncs on a schedule yet — every refresh here is a manual trigger of the Worker&apos;s{" "}
            <code>/api/sync/*</code> routes.
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
              Knowledge base
              <InfoTip>
                Weekly-refreshed sources feeding the topic-suggestion + draft engine. lyzr_blog runs for real; Slack,
                Drive, and internal_email no-op until their credentials are configured — see SETUP_INTEGRATIONS.md.
              </InfoTip>
            </h2>
            <div className="flex items-center gap-2">
              <Button
                variant={driveConnection?.connected ? "secondary" : "primary"}
                size="sm"
                onClick={handleConnectDrive}
                disabled={driveConnection?.connected}
              >
                {driveConnection?.connected ? "Drive connected ✓" : "Connect Google Drive"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => refresh("all", "knowledge/sync")}
                disabled={refreshing !== null}
              >
                <RefreshCw className={refreshing === "all" ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
                Refresh knowledge
              </Button>
            </div>
          </div>
          {driveConnection?.connected && (
            <p className="mt-1 text-xs text-zinc-400">
              Drive connected as you since {new Date(driveConnection.updatedAt!).toLocaleString()} — the knowledge
              base only sees what your own Google account can see, not the whole workspace&apos;s Drive.
            </p>
          )}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-3">
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
