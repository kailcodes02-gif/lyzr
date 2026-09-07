"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useReviewQueue } from "@/lib/hooks/use-review";
import { cn } from "@/lib/utils";
import { Badge, SourceBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/info-tip";

const MATCH_STATUS_TIP: Record<string, string> = {
  unmatched: "No known account/person matched at all.",
  ambiguous: "Multiple possible account matches — needs a human pick.",
  person_unmatched: "The account matched fine, but this specific recipient isn't in our People list.",
  account_unmatched: "This person is known, but their email domain doesn't match any tracked account.",
  both_unmatched: "Neither the account nor the person could be matched.",
};

export default function ReviewPage() {
  const { data, isLoading, error } = useReviewQueue();
  const [tab, setTab] = useState<"accounts" | "communications">("accounts");
  const [search, setSearch] = useState("");

  const filteredLinks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data?.links ?? [];
    return (data?.links ?? []).filter(
      (l) => l.source_name?.toLowerCase().includes(q) || l.source_domain?.toLowerCase().includes(q)
    );
  }, [data?.links, search]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data?.events ?? [];
    return (data?.events ?? []).filter(
      (e) => e.recipient_email.toLowerCase().includes(q) || e.subject?.toLowerCase().includes(q)
    );
  }, [data?.events, search]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-zinc-900 flex items-center gap-1.5">
        Needs Review
        <InfoTip>
          Nothing from a source is ever silently dropped — records that couldn&apos;t be automatically matched land
          here instead of vanishing.
        </InfoTip>
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        Manual linking actions come in a later pass; for now this is a read-only view of what needs attention.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 border-b border-zinc-200">
          <button
            onClick={() => setTab("accounts")}
            className={cn(
              "px-3 py-2 text-sm border-b-2 -mb-px",
              tab === "accounts" ? "border-zinc-900 text-zinc-900 font-medium" : "border-transparent text-zinc-500"
            )}
          >
            Accounts ({data?.links.length ?? 0})
          </button>
          <button
            onClick={() => setTab("communications")}
            className={cn(
              "px-3 py-2 text-sm border-b-2 -mb-px",
              tab === "communications" ? "border-zinc-900 text-zinc-900 font-medium" : "border-transparent text-zinc-500"
            )}
          >
            Communications ({data?.events.length ?? 0})
          </button>
          <InfoTip>
            <strong>Accounts</strong>: HubSpot companies that couldn&apos;t be domain-matched to a Cortex account.
            <br />
            <strong>Communications</strong>: synced emails where the recipient isn&apos;t a known account/person.
            Capped to the most recent 200.
          </InfoTip>
        </div>
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-8 py-1.5 text-xs" />
        </div>
      </div>

      {isLoading && <div className="mt-4 text-sm text-zinc-400">Loading…</div>}
      {error && <div className="mt-4 text-sm text-red-600">{(error as Error).message}</div>}

      {tab === "accounts" && data && (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100">
          {filteredLinks.length === 0 && (
            <div className="p-3 text-sm text-zinc-400">
              {data.links.length === 0 ? "Nothing unmatched — every source record has an account." : "No matches."}
            </div>
          )}
          {filteredLinks.map((l) => (
            <div key={l.id} className="p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-zinc-900">{l.source_name ?? l.source_id}</span>
                <Badge color="amber" title={MATCH_STATUS_TIP[l.match_status]}>
                  {l.match_status}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <SourceBadge source={l.source_system} />
                <span className="text-xs text-zinc-500">
                  {l.source_object_type} · {l.source_domain ?? "no domain"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "communications" && data && (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100 max-h-[600px] overflow-y-auto">
          {filteredEvents.length === 0 && (
            <div className="p-3 text-sm text-zinc-400">
              {data.events.length === 0
                ? "Nothing unmatched — every synced email resolved to a known account/person."
                : "No matches."}
            </div>
          )}
          {filteredEvents.map((e) => (
            <div key={e.id} className="p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-zinc-900 truncate">{e.subject ?? "(no subject)"}</span>
                <Badge color="amber" title={MATCH_STATUS_TIP[e.match_status]}>
                  {e.match_status}
                </Badge>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <SourceBadge source={e.source_system} />
                <span className="text-xs text-zinc-500">
                  {e.sender_email ? `from ${e.sender_email} ` : ""}to {e.recipient_email} ({e.recipient_email_domain ?? "?"}) ·{" "}
                  {new Date(e.sent_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
