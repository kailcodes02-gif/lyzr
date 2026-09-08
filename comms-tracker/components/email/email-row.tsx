"use client";

import { Badge, SourceBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CommunicationEventRow } from "@/lib/hooks/use-data";

// One email in a timeline list. Double-click (or the keyboard) opens the
// full message via EmailDialog, which the parent list owns.
export function EmailRow({ e, onOpen, compact }: { e: CommunicationEventRow; onOpen: (id: string) => void; compact?: boolean }) {
  return (
    <div
      role="button"
      tabIndex={0}
      title="Double-click to read the full email"
      onDoubleClick={() => onOpen(e.id)}
      onKeyDown={(ev) => ev.key === "Enter" && onOpen(e.id)}
      className={cn("hover:bg-muted/50 cursor-default select-none transition-colors focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]", compact ? "rounded-md px-2 py-1.5 text-xs" : "p-4 text-sm")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{e.subject ?? "(no subject)"}</span>
        <span className="text-muted-foreground shrink-0 text-xs">{compact ? new Date(e.sent_at).toLocaleString() : new Date(e.sent_at).toLocaleDateString()}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <SourceBadge source={e.source_system} />
        <span className="text-muted-foreground text-xs">
          {e.sender_email ? `from ${e.sender_email} ` : ""}to {e.recipient_email}
        </span>
        {e.match_status !== "matched" && <Badge color="amber">{e.match_status}</Badge>}
      </div>
      {(e.ai_summary || e.snippet) && <p className={cn("text-muted-foreground mt-1.5 line-clamp-2", compact ? "text-xs" : "text-xs")}>{e.ai_summary ?? e.snippet}</p>}
    </div>
  );
}
