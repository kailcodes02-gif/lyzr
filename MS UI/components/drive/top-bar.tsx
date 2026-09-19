"use client";

import { ArrowDownAZ, Check, ChevronDown, LayoutGrid, List, Search, X } from "lucide-react";
import { forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { KIND_LABEL, type FileKind } from "@/lib/files";
import type { ModifiedFilter, SortKey } from "@/lib/drive/logic";
import { cn } from "@/lib/utils";

const TYPE_CHOICES: FileKind[] = ["doc", "sheet", "slide", "pdf", "image", "video", "audio", "archive", "text", "folder"];
const MODIFIED: { key: ModifiedFilter; label: string }[] = [
  { key: "today", label: "Today" }, { key: "7d", label: "Last 7 days" }, { key: "30d", label: "Last 30 days" }, { key: "year", label: "This year" },
];
const SORTS: { key: SortKey; label: string }[] = [{ key: "name", label: "Name" }, { key: "modified", label: "Last modified" }, { key: "size", label: "Size" }];

function Chip({ label, active, onClear, children }: { label: string; active: boolean; onClear?: () => void; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-colors",
              active ? "border-transparent bg-[#c2e7ff] text-[#001d35] dark:bg-primary/25 dark:text-foreground" : "border-border hover:bg-muted"
            )}
          />
        }
      >
        {label}
        {active && onClear ? (
          <X
            className="h-3.5 w-3.5"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onClear();
            }}
          />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48 rounded-xl p-1">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

export type Filters = { kinds: FileKind[]; owner: string | null; modified: ModifiedFilter };

export const TopBar = forwardRef<
  HTMLInputElement,
  {
    q: string;
    onQ: (q: string) => void;
    filters: Filters;
    onFilters: (f: Filters) => void;
    owners: string[];
    sort: SortKey;
    onSort: (s: SortKey) => void;
    layout: "grid" | "list";
    onLayout: (l: "grid" | "list") => void;
  }
>(function TopBar({ q, onQ, filters, onFilters, owners, sort, onSort, layout, onLayout }, ref) {
  return (
    <div className="flex flex-col gap-2 px-4 pt-3 pb-2">
      <div className="relative max-w-2xl">
        <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={ref}
          value={q}
          onChange={(e) => onQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onQ("");
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Search in OneDrive"
          aria-label="Search in OneDrive"
          className="h-11 w-full rounded-full border border-transparent bg-[#e9eef6] pr-10 pl-11 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-border focus:bg-background focus:shadow-md dark:bg-muted"
        />
        {q ? (
          <button type="button" onClick={() => onQ("")} aria-label="Clear search" className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1 hover:bg-black/10">
            <X className="h-4 w-4" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 rounded border border-border bg-background px-1.5 text-[10px] text-muted-foreground">/</kbd>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip label={filters.kinds.length ? filters.kinds.map((k) => KIND_LABEL[k]).join(", ") : "Type"} active={filters.kinds.length > 0} onClear={() => onFilters({ ...filters, kinds: [] })}>
          {TYPE_CHOICES.map((k) => {
            const on = filters.kinds.includes(k);
            return (
              <DropdownMenuItem key={k} closeOnClick={false} onClick={() => onFilters({ ...filters, kinds: on ? filters.kinds.filter((x) => x !== k) : [...filters.kinds, k] })} className="gap-2 px-2 py-1.5">
                <Check className={cn("h-4 w-4", !on && "invisible")} />
                {KIND_LABEL[k]}
              </DropdownMenuItem>
            );
          })}
        </Chip>
        <Chip label={filters.owner ?? "People"} active={Boolean(filters.owner)} onClear={() => onFilters({ ...filters, owner: null })}>
          {owners.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No owners yet</div>}
          {owners.map((o) => (
            <DropdownMenuItem key={o} onClick={() => onFilters({ ...filters, owner: o })} className="gap-2 px-2 py-1.5">
              <Check className={cn("h-4 w-4", filters.owner !== o && "invisible")} />
              {o}
            </DropdownMenuItem>
          ))}
        </Chip>
        <Chip label={MODIFIED.find((m) => m.key === filters.modified)?.label ?? "Modified"} active={Boolean(filters.modified)} onClear={() => onFilters({ ...filters, modified: "" })}>
          {MODIFIED.map((m) => (
            <DropdownMenuItem key={m.key} onClick={() => onFilters({ ...filters, modified: m.key })} className="gap-2 px-2 py-1.5">
              <Check className={cn("h-4 w-4", filters.modified !== m.key && "invisible")} />
              {m.label}
            </DropdownMenuItem>
          ))}
        </Chip>
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="gap-1.5 text-[13px] font-normal" />}>
              <ArrowDownAZ className="h-4 w-4" />
              {SORTS.find((s) => s.key === sort)?.label}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 rounded-xl p-1">
              {SORTS.map((s) => (
                <DropdownMenuItem key={s.key} onClick={() => onSort(s.key)} className="gap-2 px-2 py-1.5">
                  <Check className={cn("h-4 w-4", sort !== s.key && "invisible")} />
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex overflow-hidden rounded-full border border-border" role="group" aria-label="Layout">
            <button type="button" aria-label="List layout" aria-pressed={layout === "list"} onClick={() => onLayout("list")} className={cn("flex h-8 w-10 items-center justify-center", layout === "list" ? "bg-[#c2e7ff] dark:bg-primary/25" : "hover:bg-muted")}>
              <List className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Grid layout" aria-pressed={layout === "grid"} onClick={() => onLayout("grid")} className={cn("flex h-8 w-10 items-center justify-center", layout === "grid" ? "bg-[#c2e7ff] dark:bg-primary/25" : "hover:bg-muted")}>
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
