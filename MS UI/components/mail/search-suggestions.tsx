"use client";

import { Clock, Paperclip, Search, SlidersHorizontal, X } from "lucide-react";
import type { Person } from "@/lib/people";
import { matchOperators, peopleQuery, type PersonKind, type QuickOperator, type SearchChip } from "@/lib/mail/search";
import { cn } from "@/lib/utils";

// One row of the dropdown. Pure data so the parent owns keyboard state and
// tests can assert on the list without rendering.
export type SuggestionItem =
  | { id: string; type: "person"; kind: PersonKind; person: Person }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "recent"; kql: string }
  | { id: string; type: "operator"; op: QuickOperator };

export function suggestionItems({ text, chips, people, recent, maxPeople = 5 }: { text: string; chips: SearchChip[]; people: Person[]; recent: string[]; maxPeople?: number }): SuggestionItem[] {
  const out: SuggestionItem[] = [];
  const t = text.trim();
  if (!t) {
    for (const kql of recent) out.push({ id: `recent:${kql}`, type: "recent", kql });
    for (const op of matchOperators("", chips)) out.push({ id: `op:${op.id}`, type: "operator", op });
    return out;
  }
  const { kind, query } = peopleQuery(t);
  if (query) {
    const taken = new Set(chips.filter((c): c is Extract<SearchChip, { email: string }> => c.kind === kind).map((c) => c.email.toLowerCase()));
    for (const person of people.filter((p) => !taken.has(p.email.toLowerCase())).slice(0, maxPeople)) out.push({ id: `${kind}:${person.email}`, type: "person", kind, person });
  }
  out.push({ id: `text:${t}`, type: "text", text: t });
  for (const op of matchOperators(t, chips)) out.push({ id: `op:${op.id}`, type: "operator", op });
  return out;
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const KIND_LABEL: Record<PersonKind, string> = { from: "From", to: "To", cc: "Cc" };

// The dropdown itself. The parent input handles ArrowUp/Down/Enter/Escape and
// passes the active index; mouse picks go through onSelect too.
export function SearchSuggestions({
  items,
  active,
  isSearching,
  onSelect,
  onHover,
  onForgetRecent,
  className,
}: {
  items: SuggestionItem[];
  active: number;
  isSearching?: boolean;
  onSelect: (item: SuggestionItem) => void;
  onHover?: (index: number) => void;
  onForgetRecent?: (kql: string) => void;
  className?: string;
}) {
  if (!items.length && !isSearching) return null;
  const pick = (e: React.MouseEvent, item: SuggestionItem) => {
    e.preventDefault();
    onSelect(item);
  };
  const row = (i: number) => cn("flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm", i === active && "bg-accent");
  return (
    <ul id="search-suggestions" role="listbox" aria-label="Search suggestions" data-testid="search-suggestions" className={cn("absolute left-0 top-full z-30 mt-1 w-full overflow-hidden rounded-xl border border-border bg-popover py-1 shadow-lg", className)}>
      {items.map((item, i) => {
        const shared = { role: "option" as const, "aria-selected": i === active, onMouseEnter: () => onHover?.(i), onMouseDown: (e: React.MouseEvent) => pick(e, item) };
        if (item.type === "person") {
          const p = item.person;
          return (
            <li key={item.id} {...shared} data-testid="search-person" className={row(i)}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-medium text-primary" aria-hidden>
                {initialsOf(p.name)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{p.name}</span>
                <span className="truncate text-xs text-muted-foreground">{p.title ? `${p.title} · ${p.email}` : p.email}</span>
              </span>
              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{KIND_LABEL[item.kind]}</span>
            </li>
          );
        }
        if (item.type === "text") {
          return (
            <li key={item.id} {...shared} data-testid="search-text" className={row(i)}>
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                Search for &lsquo;<span className="font-medium">{item.text}</span>&rsquo;
              </span>
            </li>
          );
        }
        if (item.type === "recent") {
          return (
            <li key={item.id} {...shared} data-testid="search-recent" className={row(i)}>
              <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{item.kql}</span>
              {onForgetRecent && (
                <button
                  type="button"
                  aria-label={`Forget search ${item.kql}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onForgetRecent(item.kql);
                  }}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          );
        }
        return (
          <li key={item.id} {...shared} data-testid="search-operator" className={row(i)}>
            {item.op.id === "has" ? <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" /> : <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">{item.op.label}</span>
            <span className="truncate text-xs text-muted-foreground">{item.op.hint}</span>
          </li>
        );
      })}
      {isSearching && <li className="px-3 py-1 text-[11px] text-muted-foreground">Searching people…</li>}
    </ul>
  );
}
