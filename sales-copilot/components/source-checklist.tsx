"use client";

import { CheckCheck, Square, type LucideIcon } from "lucide-react";

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  bodyText: string;
}

export interface KbEntrySummary {
  id: string;
  title: string;
  preview: string;
}

export function formatDate(dateHeader: string): string {
  const d = new Date(dateHeader);
  return Number.isNaN(d.getTime())
    ? dateHeader
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function SourceGroupHeader({
  icon: Icon,
  title,
  count,
  allChecked,
  onToggleAll,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  allChecked: boolean;
  onToggleAll: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 text-brand-terracotta" strokeWidth={1.75} />
        {title}
        <span className="text-xs font-normal text-muted-foreground">({count})</span>
      </div>
      <button
        type="button"
        onClick={onToggleAll}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        {allChecked ? <CheckCheck className="size-3.5" /> : <Square className="size-3.5" />}
        {allChecked ? "Deselect all" : "Select all"}
      </button>
    </div>
  );
}

export function SourceRow({
  checked,
  onChange,
  title,
  meta,
  snippet,
  trailing,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  meta?: string;
  snippet?: string;
  trailing?: string;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm cursor-pointer transition-colors ${
        checked ? "border-brand-terracotta/30 bg-brand-terracotta/5" : "border-border hover:bg-muted/40"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 size-4 accent-brand-terracotta shrink-0"
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium truncate">{title || "(no subject)"}</span>
          {trailing && <span className="text-xs text-muted-foreground shrink-0">{trailing}</span>}
        </div>
        {meta && <div className="text-xs text-muted-foreground truncate">{meta}</div>}
        {snippet && <p className="text-xs text-muted-foreground/80 line-clamp-1">{snippet}</p>}
      </div>
    </label>
  );
}

export function MessageChecklist({
  icon,
  title,
  messages,
  selected,
  onToggle,
  onToggleAll,
}: {
  icon: LucideIcon;
  title: string;
  messages: GmailMessageSummary[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
}) {
  if (messages.length === 0) return null;
  const allChecked = messages.every((m) => selected.has(m.id));

  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 bg-muted/20 p-4">
      <SourceGroupHeader
        icon={icon}
        title={title}
        count={messages.length}
        allChecked={allChecked}
        onToggleAll={() => onToggleAll(!allChecked)}
      />
      <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
        {messages.map((m) => (
          <SourceRow
            key={m.id}
            checked={selected.has(m.id)}
            onChange={() => onToggle(m.id)}
            title={m.subject}
            meta={m.from}
            snippet={m.snippet}
            trailing={formatDate(m.date)}
          />
        ))}
      </div>
    </div>
  );
}

export function KbChecklist({
  icon,
  entries,
  selected,
  onToggle,
  onToggleAll,
}: {
  icon: LucideIcon;
  entries: KbEntrySummary[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
}) {
  if (entries.length === 0) return null;
  const allChecked = entries.every((e) => selected.has(e.id));

  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 bg-muted/20 p-4">
      <SourceGroupHeader
        icon={icon}
        title="Knowledge base"
        count={entries.length}
        allChecked={allChecked}
        onToggleAll={() => onToggleAll(!allChecked)}
      />
      <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
        {entries.map((e) => (
          <SourceRow
            key={e.id}
            checked={selected.has(e.id)}
            onChange={() => onToggle(e.id)}
            title={e.title}
            snippet={e.preview}
          />
        ))}
      </div>
    </div>
  );
}
