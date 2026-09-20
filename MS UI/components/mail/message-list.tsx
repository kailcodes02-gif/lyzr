"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { Archive, ChevronLeft, ChevronRight, Inbox, Mail, MailOpen, Paperclip, RefreshCw, Star, Tag, Trash2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMailDate } from "@/lib/format";
import { updatedAgoLabel } from "@/lib/mail/freshness";
import { participantLabel, presetHex } from "@/lib/mail/logic";
import type { OutlookCategory, Thread } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

export type ListActions = {
  archive: (ids: string[]) => void;
  trash: (ids: string[]) => void;
  setRead: (ids: string[], read: boolean) => void;
  setStar: (ids: string[], starred: boolean) => void;
};

function IconButton({ label, onClick, children, className }: { label: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label={label} onClick={onClick} className={cn("flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10", className)} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ThreadRow({ thread, selected, focused, meAddress, categories, onOpen, onToggleSelect, actions, isTrashOrSpam }: { thread: Thread; selected: boolean; focused: boolean; meAddress?: string; categories?: OutlookCategory[]; onOpen: () => void; onToggleSelect: () => void; actions: ListActions; isTrashOrSpam?: boolean }) {
  const ids = thread.messages.map((m) => m.id);
  const colorOf = (name: string) => presetHex(categories?.find((c) => c.displayName === name)?.color);
  const subject = thread.latest.subject || "(no subject)";
  return (
    <div
      role="row"
      aria-selected={selected}
      data-focused={focused || undefined}
      tabIndex={-1}
      onClick={onOpen}
      className={cn(
        "group relative flex h-10 cursor-pointer items-center gap-1 border-b border-border/70 pl-2 pr-3 text-sm outline-none",
        thread.unread ? "bg-card font-semibold" : "bg-muted/40 text-foreground/80",
        selected && "bg-accent/60",
        focused && "shadow-[inset_3px_0_0_var(--primary)]",
        "hover:z-10 hover:shadow-[0_1px_3px_rgba(0,0,0,0.18)]"
      )}
    >
      <div onClick={(e) => e.stopPropagation()} className={cn("flex w-6 items-center justify-center", !selected && "opacity-0 group-hover:opacity-100 group-data-[focused]:opacity-100")}>
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label={`Select ${subject}`} />
      </div>
      <button
        type="button"
        aria-label={thread.starred ? "Unstar" : "Star"}
        aria-pressed={thread.starred}
        onClick={(e) => {
          e.stopPropagation();
          actions.setStar(thread.starred ? ids : [thread.latest.id], !thread.starred);
        }}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-black/10"
      >
        <Star className={cn("h-4 w-4", thread.starred ? "fill-[#f4b400] text-[#f4b400]" : "text-muted-foreground opacity-50 group-hover:opacity-100")} />
      </button>
      <div className="w-44 shrink-0 truncate pr-2" title={thread.participants.join(", ")}>
        {participantLabel(thread, meAddress)}
        {thread.messages.length > 1 && <span className="ml-1 text-xs font-normal text-muted-foreground">{thread.messages.length}</span>}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {thread.latest.importance === "high" && <span className="text-destructive" title="High importance">!</span>}
        {thread.categories.slice(0, 3).map((c) => (
          <span key={c} className="inline-flex max-w-32 shrink-0 items-center gap-1 truncate rounded-sm px-1.5 text-[11px] font-medium text-white" style={{ background: colorOf(c) }}>
            {c}
          </span>
        ))}
        <span className="truncate">
          {thread.latest.isDraft && <span className="text-destructive">Draft </span>}
          {subject}
          <span className="font-normal text-muted-foreground"> - {thread.latest.bodyPreview}</span>
        </span>
      </div>
      {thread.hasAttachments && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Has attachment" />}
      <span className={cn("w-16 shrink-0 text-right text-xs group-hover:invisible", thread.unread ? "font-semibold" : "text-muted-foreground")}>{formatMailDate(thread.latest.receivedDateTime)}</span>
      <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 bg-inherit group-hover:flex" onClick={(e) => e.stopPropagation()}>
        {!isTrashOrSpam && (
          <IconButton label="Archive" onClick={() => actions.archive(ids)}>
            <Archive className="h-4 w-4" />
          </IconButton>
        )}
        <IconButton label="Delete" onClick={() => actions.trash(ids)}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
        <IconButton label={thread.unread ? "Mark as read" : "Mark as unread"} onClick={() => actions.setRead(thread.unread ? ids : [thread.latest.id], thread.unread)}>
          {thread.unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
        </IconButton>
      </div>
    </div>
  );
}

export function MessageList({ threads, selected, cursor, meAddress, categories, onOpen, onToggleSelect, actions, hasMore, loadMore, isFetchingMore, isTrashOrSpam }: { threads: Thread[]; selected: Set<string>; cursor: number; meAddress?: string; categories?: OutlookCategory[]; onOpen: (t: Thread) => void; onToggleSelect: (t: Thread) => void; actions: ListActions; hasMore?: boolean; loadMore?: () => void; isFetchingMore?: boolean; isTrashOrSpam?: boolean }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: threads.length + (hasMore ? 1 : 0), getScrollElement: () => parentRef.current, estimateSize: () => 40, overscan: 12 });
  const items = v.getVirtualItems();
  useEffect(() => {
    const last = items[items.length - 1];
    if (last && hasMore && !isFetchingMore && last.index >= threads.length - 1) loadMore?.();
  }, [items, hasMore, isFetchingMore, threads.length, loadMore]);
  useEffect(() => {
    if (cursor >= 0) v.scrollToIndex(cursor, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  return (
    <div ref={parentRef} role="grid" aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {items.map((it) => {
          const t = threads[it.index];
          return (
            <div key={t?.conversationId ?? "more"} data-index={it.index} ref={v.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${it.start}px)` }}>
              {t ? (
                <ThreadRow thread={t} selected={selected.has(t.conversationId)} focused={cursor === it.index} meAddress={meAddress} categories={categories} onOpen={() => onOpen(t)} onToggleSelect={() => onToggleSelect(t)} actions={actions} isTrashOrSpam={isTrashOrSpam} />
              ) : (
                <div className="flex h-10 items-center justify-center text-xs text-muted-foreground">Loading more</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div className="divide-y divide-border/70" aria-busy>
      {Array.from({ length: 14 }).map((_, i) => (
        <div key={i} className="flex h-10 items-center gap-3 px-4">
          <div className="h-4 w-4 rounded bg-muted" />
          <div className="h-3 w-36 animate-pulse rounded bg-muted" />
          <div className="h-3 flex-1 animate-pulse rounded bg-muted" style={{ maxWidth: `${40 + ((i * 17) % 50)}%` }} />
          <div className="h-3 w-10 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function EmptyList({ folder, query }: { folder: string; query?: string }) {
  const msg = query ? `No results for "${query}"` : folder === "inbox" ? "Your inbox is empty. Nice work." : folder === "starred" ? "No starred conversations. Star messages to find them here." : folder === "drafts" ? "No drafts" : "Nothing here";
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
      <Inbox className="h-8 w-8 opacity-40" />
      <p>{msg}</p>
    </div>
  );
}

// Ticks once a second while the tab is visible so "Updated <n>s ago" stays true.
function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

export function UpdatedAgo({ at }: { at?: number }) {
  const now = useNow();
  const label = updatedAgoLabel(at ?? 0, Math.max(now, at ?? 0));
  if (!label) return null;
  return <span className="text-xs text-muted-foreground" data-testid="updated-ago">{label}</span>;
}

export function ListToolbar({ total, selectedCount, allSelected, onSelectAll, onClear, onRefresh, refreshing, updatedAt, onArchive, onTrash, onRead, onUnread, onSpam, onLabel, page, onPrev, onNext, hasPrev, hasNext, isTrashOrSpam, onInbox }: { total: number; selectedCount: number; allSelected: boolean; onSelectAll: () => void; onClear: () => void; onRefresh: () => void; refreshing?: boolean; updatedAt?: number; onArchive: () => void; onTrash: () => void; onRead: () => void; onUnread: () => void; onSpam: () => void; onLabel?: React.ReactNode; page: React.ReactNode; onPrev: () => void; onNext: () => void; hasPrev: boolean; hasNext: boolean; isTrashOrSpam?: boolean; onInbox: () => void }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
      <div className="flex w-6 items-center justify-center">
        <Checkbox checked={allSelected && total > 0} indeterminate={selectedCount > 0 && !allSelected} onCheckedChange={() => (selectedCount > 0 ? onClear() : onSelectAll())} aria-label="Select all" />
      </div>
      {selectedCount === 0 ? (
        <>
          <IconButton label="Refresh" onClick={onRefresh}>
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </IconButton>
          <UpdatedAgo at={updatedAt} />
        </>
      ) : (
        <>
          {isTrashOrSpam ? (
            <IconButton label="Move to Inbox" onClick={onInbox}>
              <Users className="h-4 w-4" />
            </IconButton>
          ) : (
            <IconButton label="Archive" onClick={onArchive}>
              <Archive className="h-4 w-4" />
            </IconButton>
          )}
          {!isTrashOrSpam && (
            <IconButton label="Report spam" onClick={onSpam}>
              <Tag className="h-4 w-4 rotate-90" />
            </IconButton>
          )}
          <IconButton label="Delete" onClick={onTrash}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
          <span className="mx-1 h-5 w-px bg-border" />
          <IconButton label="Mark as read" onClick={onRead}>
            <MailOpen className="h-4 w-4" />
          </IconButton>
          <IconButton label="Mark as unread" onClick={onUnread}>
            <Mail className="h-4 w-4" />
          </IconButton>
          {onLabel}
          <span className="ml-2 text-xs text-muted-foreground">{selectedCount} selected</span>
        </>
      )}
      <span className="ml-auto text-xs text-muted-foreground">{page}</span>
      <IconButton label="Newer" onClick={onPrev} className={cn(!hasPrev && "pointer-events-none opacity-30")}>
        <ChevronLeft className="h-4 w-4" />
      </IconButton>
      <IconButton label="Older" onClick={onNext} className={cn(!hasNext && "pointer-events-none opacity-30")}>
        <ChevronRight className="h-4 w-4" />
      </IconButton>
    </div>
  );
}
