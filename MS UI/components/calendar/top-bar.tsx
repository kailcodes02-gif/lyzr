"use client";

import { ChevronLeft, ChevronRight, HelpCircle, Menu, Plus, RefreshCw, Search, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatUpdated } from "@/lib/calendar/freshness";
import type { ViewKind } from "@/lib/calendar/types";
import { cn } from "@/lib/utils";

const VIEW_LABEL: Record<ViewKind, string> = { day: "Day", week: "Week", month: "Month", "4day": "4 days", agenda: "Agenda" };

// "Updated 12s ago" + a manual refresh. Ticks once a second while mounted.
function UpdatedAgo({ updatedAt, refreshing, onRefresh }: { updatedAt: number | null; refreshing: boolean; onRefresh: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const label = refreshing ? "Updating…" : formatUpdated(updatedAt == null ? null : now - updatedAt);
  return (
    <button
      type="button"
      onClick={onRefresh}
      aria-label="Refresh"
      title="Refresh from Microsoft"
      data-testid="refresh-button"
      className="flex h-8 items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
      <span data-testid="updated-ago" className="hidden sm:inline" aria-live="polite">
        {label}
      </span>
    </button>
  );
}

export function TopBar({
  title,
  view,
  onView,
  onToday,
  onPrev,
  onNext,
  query,
  onQuery,
  onSettings,
  onHelp,
  searchRef,
  timeZone,
  onMenu,
  onCreate,
  updatedAt = null,
  onRefresh,
  refreshing = false,
}: {
  title: string;
  view: ViewKind;
  onView: (v: ViewKind) => void;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
  query: string;
  onQuery: (q: string) => void;
  onSettings: () => void;
  onHelp: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  timeZone: string;
  // Narrow widths (below 900px): the left panel becomes a drawer, opened here.
  onMenu?: () => void;
  onCreate?: () => void;
  // When the server was last checked; the refresh control re-reads everything.
  updatedAt?: number | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
      {onMenu && (
        <Button variant="ghost" size="icon-sm" aria-label="Calendars" onClick={onMenu} className="min-[901px]:hidden">
          <Menu />
        </Button>
      )}
      <Button variant="outline" size="sm" className="rounded-full px-4" onClick={onToday}>
        Today
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Previous" onClick={onPrev}>
        <ChevronLeft />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Next" onClick={onNext}>
        <ChevronRight />
      </Button>
      <h1 className="ml-1 min-w-0 truncate text-lg font-normal" data-testid="range-title">
        {title}
      </h1>
      <span className="hidden text-xs text-muted-foreground xl:inline" title="Display time zone">
        {timeZone}
      </span>
      {onRefresh && <UpdatedAgo updatedAt={updatedAt} refreshing={refreshing} onRefresh={onRefresh} />}
      <div className="flex-1" />
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search events"
          aria-label="Search events"
          className="h-8 w-32 rounded-full border border-border bg-muted/50 pr-7 pl-8 text-sm outline-none focus:border-primary focus:bg-background sm:w-56"
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => onQuery("")} className="absolute right-2 text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {onCreate && (
        <Button variant="ghost" size="icon-sm" aria-label="Create event" onClick={onCreate} className="min-[901px]:hidden">
          <Plus />
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" onClick={onHelp}>
        <HelpCircle />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={onSettings}>
        <Settings />
      </Button>
      <Select value={view} onValueChange={(v) => v && onView(v as ViewKind)}>
        <SelectTrigger size="sm" className="rounded-full" aria-label="View">
          <SelectValue>{VIEW_LABEL[view]}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {(Object.keys(VIEW_LABEL) as ViewKind[]).map((v) => (
            <SelectItem key={v} value={v}>
              {VIEW_LABEL[v]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </header>
  );
}
