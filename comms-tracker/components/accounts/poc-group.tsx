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

function PocRow({ p, recent }: { p: AccountPersonRow; recent: CommunicationEventRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => recent.length > 0 && setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 text-left text-sm",
          recent.length > 0 && "hover:bg-zinc-50 cursor-pointer"
        )}
      >
        {recent.length > 0 ? (
          open ? (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="font-medium text-zinc-900 truncate">{p.people?.full_name ?? p.people?.email}</span>
        <span className="text-xs text-zinc-400 truncate flex-1">{p.people?.role_title ?? p.people?.email}</span>
        <Badge color={ROLE_COLOR[p.relationship_role] ?? "zinc"}>
          {p.role_label ?? ROLE_LABEL[p.relationship_role] ?? p.relationship_role}
        </Badge>
        <span className="text-xs text-zinc-400 shrink-0 w-16 text-right">
          {recent.length === 0 ? "no emails" : `${recent.length} recent`}
        </span>
      </button>
      {open && recent.length > 0 && (
        <div className="pl-9 pr-3 pb-2.5 space-y-1.5">
          {recent.map((e) => (
            <div key={e.id} className="text-xs border-l-2 border-zinc-100 pl-2.5">
              <div className="flex items-center gap-1.5">
                <SourceBadge source={e.source_system} />
                <span className="text-zinc-400">{new Date(e.sent_at).toLocaleString()}</span>
              </div>
              <div className="font-medium text-zinc-700 mt-0.5">{e.subject ?? "(no subject)"}</div>
              {e.sender_email && <div className="text-zinc-400 mt-0.5">from {e.sender_email}</div>}
              {(e.ai_summary || e.snippet) && <p className="text-zinc-500 mt-0.5 line-clamp-2">{e.ai_summary ?? e.snippet}</p>}
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
      <h2 className="text-sm font-medium text-zinc-900 mb-2 flex items-center gap-1.5">
        {title} <span className="text-xs text-zinc-400 font-normal">({people.length})</span>
        <InfoTip>{tip}</InfoTip>
      </h2>
      <div className="rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100">
        {people.length === 0 && <div className="p-3 text-sm text-zinc-400">None linked yet.</div>}
        {sorted.map(({ p, recent }, i) => {
          // First transition from "has email" to "no email" gets a divider,
          // so the split reads at a glance instead of just fading off.
          const prevHadRecent = i > 0 && sorted[i - 1].recent.length > 0;
          const showDivider = i > 0 && prevHadRecent && recent.length === 0;
          return (
            <div key={i}>
              {showDivider && (
                <div className="px-3 py-1 bg-zinc-50 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                  Not yet contacted
                </div>
              )}
              <div className="flex items-center">
                <div className="flex-1 min-w-0">
                  <PocRow p={p} recent={recent} />
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
