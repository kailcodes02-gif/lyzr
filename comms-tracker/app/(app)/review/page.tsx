"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useReviewQueue } from "@/lib/hooks/use-review";
import { EmailDialog } from "@/components/email/email-dialog";
import { Badge, SourceBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, ErrorNote, LoadingRows, PageHeader } from "@/components/ui/page";

const MATCH_STATUS_TIP: Record<string, string> = {
  unmatched: "No known account or person matched at all.",
  ambiguous: "Multiple possible account matches. Needs a human pick.",
  person_unmatched: "The account matched, but this recipient is not in the People list.",
  account_unmatched: "This person is known, but their email domain does not match any tracked account.",
  both_unmatched: "Neither the account nor the person could be matched.",
};

export default function ReviewPage() {
  const { data, isLoading, error } = useReviewQueue();
  const [tab, setTab] = useState<"accounts" | "communications">("accounts");
  const [search, setSearch] = useState("");
  const [openEmailId, setOpenEmailId] = useState<string | null>(null);

  const filteredLinks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data?.links ?? [];
    return (data?.links ?? []).filter((l) => l.source_name?.toLowerCase().includes(q) || l.source_domain?.toLowerCase().includes(q));
  }, [data?.links, search]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data?.events ?? [];
    return (data?.events ?? []).filter((e) => e.recipient_email.toLowerCase().includes(q) || e.subject?.toLowerCase().includes(q));
  }, [data?.events, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Needs Review"
        tip="Nothing from a source is silently dropped. Records that could not be matched automatically land here instead of vanishing."
        description="HubSpot companies that could not be matched to a Cortex account, and synced emails whose recipient is not a known account or person. Read-only for now."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsList>
          <TabsTrigger active={tab === "accounts"} onClick={() => setTab("accounts")}>
            Accounts <Badge className="ml-1">{data?.links.length ?? 0}</Badge>
          </TabsTrigger>
          <TabsTrigger active={tab === "communications"} onClick={() => setTab("communications")}>
            Emails <Badge className="ml-1">{data?.events.length ?? 0}</Badge>
          </TabsTrigger>
        </TabsList>
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-9" />
        </div>
      </div>

      {isLoading && <LoadingRows />}
      {error && <ErrorNote error={error} />}

      {tab === "accounts" && data && (
        filteredLinks.length === 0 ? (
          <EmptyState title={data.links.length === 0 ? "Nothing to review" : "No matches"} description={data.links.length === 0 ? "Every HubSpot company resolved to a Cortex account." : undefined} />
        ) : (
          <div className="bg-card divide-y rounded-xl border shadow-xs">
            {filteredLinks.map((l) => (
              <div key={l.id} className="p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{l.source_name ?? l.source_id}</span>
                  <Badge color="amber" title={MATCH_STATUS_TIP[l.match_status]}>{l.match_status}</Badge>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <SourceBadge source={l.source_system} />
                  <span className="text-muted-foreground text-xs">{l.source_object_type} · {l.source_domain ?? "no domain"}</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === "communications" && data && (
        filteredEvents.length === 0 ? (
          <EmptyState title={data.events.length === 0 ? "Nothing to review" : "No matches"} description={data.events.length === 0 ? "Every synced email resolved to a known account or person." : undefined} />
        ) : (
          <div className="bg-card max-h-[600px] divide-y overflow-y-auto rounded-xl border shadow-xs">
            {filteredEvents.map((e) => (
              <div key={e.id} className="hover:bg-muted/50 p-4 text-sm" onDoubleClick={() => setOpenEmailId(e.id)} title="Double-click to read the full email">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{e.subject ?? "(no subject)"}</span>
                  <Badge color="amber" title={MATCH_STATUS_TIP[e.match_status]}>{e.match_status}</Badge>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <SourceBadge source={e.source_system} />
                  <span className="text-muted-foreground text-xs">
                    {e.sender_email ? `from ${e.sender_email} ` : ""}to {e.recipient_email} · {new Date(e.sent_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )
      )}
      <EmailDialog id={openEmailId} onClose={() => setOpenEmailId(null)} />
    </div>
  );
}
