"use client";

import { Menu } from "@base-ui/react/menu";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Archive, ChevronLeft, ChevronRight, Inbox, Mail, MailOpen, Paperclip, RefreshCw, ShieldAlert, ShieldCheck, Star, Trash2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMailDate } from "@/lib/format";
import { updatedAgoLabel } from "@/lib/mail/freshness";
import { participantLabel, presetHex } from "@/lib/mail/logic";
import { TAB_LABEL, TAB_TARGETS, tabOf, type TabTarget } from "@/lib/mail/tabs";
import type { Message, OutlookCategory, Thread } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

export type ListActions = {
  archive: (ids: string[]) => void;
  trash: (ids: string[]) => void;
  setRead: (ids: string[], read: boolean) => void;
  setStar: (ids: string[], starred: boolean) => void;
  spam?: (ids: string[]) => void;
  notSpam?: (ids: string[]) => void;
  // Primary / Social / Promotions (inbox views only).
  moveToTab?: (messages: Message[], target: TabTarget) => void;
};

// Drag payload of a list row dropped onto an inbox tab (see MailApp).
export const THREAD_DRAG_TYPE = "application/x-msui-thread";

// The Move to tab entries, shared by the hover menu, the context menu and the bulk toolbar.
export function TabMoveItems({ current, onMove, Item }: { current?: TabTarget; onMove: (t: TabTarget) => void; Item: React.ComponentType<{ onClick: () => void; disabled?: boolean; children: React.ReactNode }> }) {
  return (
    <>
      {TAB_TARGETS.map((t) => (
        <Item key={t} onClick={() => onMove(t)} disabled={t === current}>
          {TAB_LABEL[t]}
        </Item>
      ))}
    </>
  );
}

function IconButton({ label, onClick, children, className, disabled }: { label: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode; className?: string; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<button type="button" aria-label={label} onClick={onClick} disabled={disabled} className={cn("flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10 disabled:opacity-40", className)} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ThreadRow({ thread, selected, focused, meAddress, categories, onOpen, onToggleSelect, actions, isTrashOrSpam, isSpam, showTabs }: { thread: Thread; selected: boolean; focused: boolean; meAddress?: string; categories?: OutlookCategory[]; onOpen: () => void; onToggleSelect: () => void; actions: ListActions; isTrashOrSpam?: boolean; isSpam?: boolean; showTabs?: boolean }) {
  const ids = thread.messages.map((m) => m.id);
  const colorOf = (name: string) => presetHex(categories?.find((c) => c.displayName === name)?.color);
  const subject = thread.latest.subject || "(no subject)";
  const currentTab = tabOf(thread.latest);
  return (
    <div
      role="row"
      aria-selected={selected}
      data-focused={focused || undefined}
      data-conversation-id={thread.conversationId}
      tabIndex={-1}
      onClick={onOpen}
      draggable={!!showTabs && !!actions.moveToTab}
      onDragStart={(e) => {
        e.dataTransfer.setData(THREAD_DRAG_TYPE, thread.conversationId);
        e.dataTransfer.effectAllowed = "move";
      }}
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
      {isSpam && actions.notSpam && (
        // Always visible (not hover-only): the way out of Spam must be obvious.
        <button
          type="button"
          aria-label="Not spam"
          onClick={(e) => {
            e.stopPropagation();
            actions.notSpam!(ids);
          }}
          className="mr-1 flex h-7 shrink-0 items-center gap-1 rounded-full border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          <ShieldCheck className="h-3.5 w-3.5" /> Not spam
        </button>
      )}
      <span className={cn("w-16 shrink-0 text-right text-xs group-hover:invisible", thread.unread ? "font-semibold" : "text-muted-foreground")}>{formatMailDate(thread.latest.receivedDateTime)}</span>
      <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 bg-inherit group-hover:flex" onClick={(e) => e.stopPropagation()}>
        {!isTrashOrSpam && (
          <IconButton label="Archive" onClick={() => actions.archive(ids)}>
            <Archive className="h-4 w-4" />
          </IconButton>
        )}
        {!isTrashOrSpam && actions.spam && (
          <IconButton label="Report spam" onClick={() => actions.spam!(ids)}>
            <ShieldAlert className="h-4 w-4" />
          </IconButton>
        )}
        <IconButton label="Delete" onClick={() => actions.trash(ids)}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
        <IconButton label={thread.unread ? "Mark as read" : "Mark as unread"} onClick={() => actions.setRead(thread.unread ? ids : [thread.latest.id], thread.unread)}>
          {thread.unread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
        </IconButton>
        {showTabs && actions.moveToTab && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger render={<DropdownMenuTrigger render={<button type="button" aria-label="Move to tab" className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10" />} />}>
                <Inbox className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent>Move to tab</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end"><DropdownMenuGroup>
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
              <TabMoveItems current={currentTab} onMove={(t) => actions.moveToTab!(thread.messages, t)} Item={DropdownMenuItem} /></DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

const ctxItem = "flex cursor-default items-center gap-1.5 rounded-md px-2 py-1 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50 [&_svg]:size-4";
const ctxPopup = "z-50 min-w-44 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none";

export function MessageList({ threads, selected, cursor, meAddress, categories, onOpen, onToggleSelect, actions, hasMore, loadMore, isFetchingMore, isTrashOrSpam, isSpam, showTabs, busy }: { threads: Thread[]; selected: Set<string>; cursor: number; meAddress?: string; categories?: OutlookCategory[]; onOpen: (t: Thread) => void; onToggleSelect: (t: Thread) => void; actions: ListActions; hasMore?: boolean; loadMore?: () => void; isFetchingMore?: boolean; isTrashOrSpam?: boolean; isSpam?: boolean; showTabs?: boolean; busy?: boolean }) {
  const parentRef = useRef<HTMLDivElement>(null);
  // One right-click menu for the whole list, anchored at the pointer: the
  // row is looked up by its data-conversation-id, so the virtualised rows
  // stay light. A plain Menu (not Base UI's ContextMenu) because the rows'
  // own hover menus may not sit inside a ContextMenu.Trigger.
  const [ctx, setCtx] = useState<{ thread: Thread; x: number; y: number } | null>(null);
  const ctxThread = ctx?.thread;
  const ctxIds = ctxThread?.messages.map((m) => m.id) ?? [];
  const anchor = { getBoundingClientRect: () => DOMRect.fromRect({ x: ctx?.x ?? 0, y: ctx?.y ?? 0, width: 0, height: 0 }) };
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
    <>
      <div
        ref={parentRef}
        role="grid"
        aria-label="Conversations"
        aria-busy={busy || undefined}
        className={cn("min-h-0 flex-1 overflow-y-auto", busy && "opacity-60 transition-opacity")}
        onContextMenu={(e) => {
          const row = (e.target as HTMLElement).closest<HTMLElement>("[data-conversation-id]");
          const t = threads.find((x) => x.conversationId === row?.dataset.conversationId);
          if (!t) return;
          e.preventDefault();
          setCtx({ thread: t, x: e.clientX, y: e.clientY });
        }}
      >
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {items.map((it) => {
            const t = threads[it.index];
            return (
              <div key={t?.conversationId ?? "more"} data-index={it.index} ref={v.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${it.start}px)` }}>
                {t ? (
                  <ThreadRow thread={t} selected={selected.has(t.conversationId)} focused={cursor === it.index} meAddress={meAddress} categories={categories} onOpen={() => onOpen(t)} onToggleSelect={() => onToggleSelect(t)} actions={actions} isTrashOrSpam={isTrashOrSpam} isSpam={isSpam} showTabs={showTabs} />
                ) : (
                  <div className="flex h-10 items-center justify-center text-xs text-muted-foreground">Loading more</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {ctxThread && (
        <Menu.Root open onOpenChange={(open) => !open && setCtx(null)}>
          <Menu.Portal>
            <Menu.Positioner className="isolate z-50 outline-none" anchor={anchor} side="bottom" align="start">
              <Menu.Popup className={ctxPopup} aria-label={`Actions for ${ctxThread.latest.subject || "(no subject)"}`}>
                <Menu.Item className={ctxItem} onClick={() => onOpen(ctxThread)}>Open</Menu.Item>
                <Menu.Item className={ctxItem} onClick={() => actions.setRead(ctxThread.unread ? ctxIds : [ctxThread.latest.id], ctxThread.unread)}>{ctxThread.unread ? "Mark as read" : "Mark as unread"}</Menu.Item>
                <Menu.Item className={ctxItem} onClick={() => actions.setStar(ctxThread.starred ? ctxIds : [ctxThread.latest.id], !ctxThread.starred)}>{ctxThread.starred ? "Unstar" : "Star"}</Menu.Item>
                <Menu.Separator className="my-1 h-px bg-border" />
                {showTabs && actions.moveToTab && (
                  <Menu.SubmenuRoot>
                    <Menu.SubmenuTrigger className={cn(ctxItem, "data-popup-open:bg-accent")}>Move to tab</Menu.SubmenuTrigger>
                    <Menu.Portal>
                      <Menu.Positioner className="isolate z-50 outline-none" side="right" align="start">
                        <Menu.Popup className={ctxPopup}>
                          <TabMoveItems current={tabOf(ctxThread.latest)} onMove={(t) => actions.moveToTab!(ctxThread.messages, t)} Item={({ onClick, disabled, children }) => <Menu.Item className={ctxItem} onClick={onClick} disabled={disabled}>{children}</Menu.Item>} />
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.SubmenuRoot>
                )}
                {!isTrashOrSpam && <Menu.Item className={ctxItem} onClick={() => actions.archive(ctxIds)}><Archive /> Archive</Menu.Item>}
                {!isTrashOrSpam && actions.spam && <Menu.Item className={ctxItem} onClick={() => actions.spam!(ctxIds)}><ShieldAlert /> Report spam</Menu.Item>}
                {isSpam && actions.notSpam && <Menu.Item className={ctxItem} onClick={() => actions.notSpam!(ctxIds)}><ShieldCheck /> Not spam</Menu.Item>}
                <Menu.Item className={ctxItem} onClick={() => actions.trash(ctxIds)}><Trash2 /> Delete</Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </>
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

export function EmptyList({ folder, query, message, hint }: { folder: string; query?: string; message?: string; hint?: React.ReactNode }) {
  const msg = message ?? (query ? `No results for "${query}"` : folder === "inbox" ? "Your inbox is empty. Nice work." : folder === "starred" ? "No starred conversations. Star messages to find them here." : folder === "drafts" ? "No drafts" : "Nothing here");
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
      <Inbox className="h-8 w-8 opacity-40" />
      <p>{msg}</p>
      {hint && <p className="text-xs">{hint}</p>}
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

export function ListToolbar({ total, selectedCount, allSelected, onSelectAll, onClear, onRefresh, refreshing, updatedAt, onArchive, onTrash, onRead, onUnread, onSpam, onNotSpam, onMoveToTab, onLabel, page, onPrev, onNext, hasPrev, hasNext, isTrashOrSpam, isSpam, onInbox, moveDisabled }: { total: number; selectedCount: number; allSelected: boolean; onSelectAll: () => void; onClear: () => void; onRefresh: () => void; refreshing?: boolean; updatedAt?: number; onArchive: () => void; onTrash: () => void; onRead: () => void; onUnread: () => void; onSpam: () => void; onNotSpam?: () => void; onMoveToTab?: (t: TabTarget) => void; onLabel?: React.ReactNode; page: React.ReactNode; onPrev: () => void; onNext: () => void; hasPrev: boolean; hasNext: boolean; isTrashOrSpam?: boolean; isSpam?: boolean; onInbox: () => void; moveDisabled?: boolean }) {
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
          {isSpam && onNotSpam ? (
            <IconButton label="Not spam" onClick={onNotSpam} disabled={moveDisabled}>
              <ShieldCheck className="h-4 w-4" />
            </IconButton>
          ) : isTrashOrSpam ? (
            <IconButton label="Move to Inbox" onClick={onInbox} disabled={moveDisabled}>
              <Users className="h-4 w-4" />
            </IconButton>
          ) : (
            <IconButton label="Archive" onClick={onArchive} disabled={moveDisabled}>
              <Archive className="h-4 w-4" />
            </IconButton>
          )}
          {!isTrashOrSpam && (
            <IconButton label="Report spam" onClick={onSpam} disabled={moveDisabled}>
              <ShieldAlert className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton label="Delete" onClick={onTrash} disabled={moveDisabled}>
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
          {onMoveToTab && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger render={<DropdownMenuTrigger render={<button type="button" aria-label="Move to tab" className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10" />} />}>
                  <Inbox className="h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent>Move to tab</TooltipContent>
              </Tooltip>
              <DropdownMenuContent><DropdownMenuGroup>
                <DropdownMenuLabel>Move to</DropdownMenuLabel>
                <TabMoveItems onMove={onMoveToTab} Item={DropdownMenuItem} /></DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
