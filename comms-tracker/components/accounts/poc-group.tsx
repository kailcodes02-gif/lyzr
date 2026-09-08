"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { AccountPersonRow, CommunicationEventRow } from "@/lib/hooks/use-data";
import { cn } from "@/lib/utils";
import { Badge, SourceBadge, type BadgeColor } from "@/components/ui/badge";
import { InfoTip } from "@/components/ui/info-tip";

// Shared between the account detail page (rolled up across all of an
// account's projects) and the project detail page (one project's own
// stakeholders) -- same display, different data scope.

export const ROLE_LABEL: Record<string, string> = {
  product_owner: "Product Owner",
  deal_owner: "Deal Owner",
  project_owner: "Project Owner",
  client_poc_primary: "Primary",
  client_poc_secondary: "Sponsor",
  client_poc_other: "Contact",
};

export const ROLE_COLOR: Record<string, BadgeColor> = {
  product_owner: "violet",
  deal_owner: "orange",
  project_owner: "violet",
  client_poc_primary: "emerald",
  client_poc_secondary: "emerald",
  client_poc_other: "zinc",
};

function PocRow({ p, recent, onOpenEmail }: { p: AccountPersonRow; recent: CommunicationEventRow[]; onOpenEmail?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => recent.length > 0 && setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 text-left text-sm",
          recent.length > 0 && "hover:bg-muted/40 cursor-pointer"
        )}
      >
        {recent.length > 0 ? (
          open ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="font-medium text-foreground truncate">{p.people?.full_name ?? p.people?.email}</span>
        <span className="text-xs text-muted-foreground truncate flex-1">{p.people?.role_title ?? p.people?.email}</span>
        <Badge color={ROLE_COLOR[p.relationship_role] ?? "zinc"}>
          {p.role_label ?? ROLE_LABEL[p.relationship_role] ?? p.relationship_role}
        </Badge>
        <span className="text-xs text-muted-foreground shrink-0 w-16 text-right">
          {recent.length === 0 ? "no emails" : `${recent.length} recent`}
        </span>
      </button>
      {open && recent.length > 0 && (
        <div className="pl-9 pr-3 pb-2.5 space-y-1.5">
          {recent.map((e) => (
            <div
              key={e.id}
              role="button"
              tabIndex={0}
              title="Double-click to read the full email"
              onDoubleClick={() => onOpenEmail?.(e.id)}
              onKeyDown={(ev) => ev.key === "Enter" && onOpenEmail?.(e.id)}
              className="hover:bg-muted/60 rounded-md border-l-2 border-border pl-2.5 pr-2 py-1 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <div className="flex items-center gap-1.5">
                <SourceBadge source={e.source_system} />
                <span className="text-muted-foreground">{new Date(e.sent_at).toLocaleString()}</span>
              </div>
              <div className="mt-0.5 font-medium">{e.subject ?? "(no subject)"}</div>
              {e.sender_email && <div className="text-muted-foreground mt-0.5">from {e.sender_email}</div>}
              {(e.ai_summary || e.snippet) && <p className="text-muted-foreground mt-0.5 line-clamp-2">{e.ai_summary ?? e.snippet}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PocGroup({
  title,
  tip,
  people,
  lastTwoByPersonId,
  renderAction,
  onOpenEmail,
}: {
  title: string;
  tip: string;
  people: AccountPersonRow[];
  lastTwoByPersonId: Map<string, CommunicationEventRow[]>;
  // Project detail page hangs a "Reassign" admin control off each owner-role
  // row; the account rollup view doesn't (an override belongs to one
  // project, not an ambiguous rollup) -- optional so both callers share
  // this component without one dictating the other's UI.
  renderAction?: (p: AccountPersonRow) => React.ReactNode;
  onOpenEmail?: (id: string) => void;
}) {
  // Contacted people float to the top (most-recently-emailed first);
  // never-contacted people sort to the bottom, alphabetically — so it
  // reads as "who's engaged" first, "who's been missed" second.
  const sorted = useMemo(() => {
    const withRecent = people.map((p) => ({
      p,
      recent: (p.people && lastTwoByPersonId.get(p.people.id)) ?? [],
    }));
    return withRecent.sort((a, b) => {
      // The primary external deal contact pins to the very top regardless
      // of recency -- everyone else (internal or external) sorts by most
      // recently contacted below them.
      const aPrimary = a.p.relationship_role === "client_poc_primary";
      const bPrimary = b.p.relationship_role === "client_poc_primary";
      if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;

      const aLatest = a.recent[0]?.sent_at;
      const bLatest = b.recent[0]?.sent_at;
      if (aLatest && bLatest) return bLatest.localeCompare(aLatest);
      if (aLatest) return -1;
      if (bLatest) return 1;
      return (a.p.people?.full_name ?? a.p.people?.email ?? "").localeCompare(
        b.p.people?.full_name ?? b.p.people?.email ?? ""
      );
    });
  }, [people, lastTwoByPersonId]);

  return (
    <div>
      <h2 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
        {title} <span className="text-xs text-muted-foreground font-normal">({people.length})</span>
        <InfoTip>{tip}</InfoTip>
      </h2>
      <div className="rounded-xl border bg-card shadow-xs divide-y divide-border">
        {people.length === 0 && <div className="p-3 text-sm text-muted-foreground">None linked yet.</div>}
        {sorted.map(({ p, recent }, i) => {
          // First transition from "has email" to "no email" gets a divider,
          // so the split reads at a glance instead of just fading off.
          const prevHadRecent = i > 0 && sorted[i - 1].recent.length > 0;
          const showDivider = i > 0 && prevHadRecent && recent.length === 0;
          return (
            <div key={i}>
              {showDivider && (
                <div className="px-3 py-1 bg-muted/40 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Not yet contacted
                </div>
              )}
              <div className="flex items-center">
                <div className="flex-1 min-w-0">
                  <PocRow p={p} recent={recent} onOpenEmail={onOpenEmail} />
                </div>
                {renderAction && <div className="pr-3 shrink-0">{renderAction(p)}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
