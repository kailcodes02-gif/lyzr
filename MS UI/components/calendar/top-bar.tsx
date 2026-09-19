"use client";

import { ChevronLeft, ChevronRight, HelpCircle, Search, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ViewKind } from "@/lib/calendar/types";

const VIEW_LABEL: Record<ViewKind, string> = { day: "Day", week: "Week", month: "Month", "4day": "4 days", agenda: "Agenda" };

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
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
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
      <div className="flex-1" />
      <div className="relative hidden items-center md:flex">
        <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search events"
          aria-label="Search events"
          className="h-8 w-56 rounded-full border border-border bg-muted/50 pr-7 pl-8 text-sm outline-none focus:border-primary focus:bg-background"
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => onQuery("")} className="absolute right-2 text-muted-foreground hover:text-foreground">
            <X className="size-3.5" />
          </button>
        )}
      </div>
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
