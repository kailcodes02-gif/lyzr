"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Menu, Search, SlidersHorizontal, Tag, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMe } from "@/lib/hooks";
import { flattenPages, useCategories, useDraftApi, useFolders, useInboxDelta, useMessageActions, useMessageList } from "@/lib/mail/hooks";
import { buildKql, groupThreads, parseKql, presetHex, WELL_KNOWN_LABEL, type WellKnown } from "@/lib/mail/logic";
import type { Message, Thread } from "@/lib/mail/types";
import { parseMailUrl, serializeMailUrl, type MailUrlState } from "@/lib/mail/url";
import { rememberRecipients } from "@/lib/people";
import { cn } from "@/lib/utils";
import { ComposeDrawer, draftFromMessage, type ComposeDraft } from "./compose";
import { MailErrorState } from "./consent-gate";
import { FolderPanel } from "./folder-panel";
import { EmptyList, ListSkeleton, ListToolbar, MessageList } from "./message-list";
import { ShortcutHelp, useMailShortcuts } from "./shortcuts";
import { ThreadView, type ReplyKind } from "./thread-view";

const UNDO_MS = 5000;

export function MailApp() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const state = useMemo(() => parseMailUrl(sp.toString()), [sp]);
  const nav = useCallback(
    (patch: Partial<MailUrlState>, replace = false) => {
      const next = serializeMailUrl({ ...state, ...patch });
      const url = `${pathname}${next}`;
      if (replace) router.replace(url);
      else router.push(url);
    },
    [state, pathname, router]
  );

  const me = useMe();
  const meAddress = me.data?.mail ?? me.data?.userPrincipalName ?? undefined;
  const folders = useFolders();
  const categories = useCategories();
  const actions = useMessageActions();
  const draftApi = useDraftApi();
  const isInbox = state.folder === "inbox" && !state.query;
  const tab = isInbox ? (state.tab ?? "focused") : undefined;
  const list = useMessageList(state.folder, tab, state.query);
  const messages = useMemo(() => flattenPages(list.data), [list.data]);
  const threads = useMemo(() => groupThreads(messages), [messages]);
  const isTrashOrSpam = state.folder === "deleteditems" || state.folder === "junkemail";

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(-1);
  const [help, setHelp] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeDraft | null>(null);
  const [searchText, setSearchText] = useState(state.query ?? "");
  const [adv, setAdv] = useState(() => parseKql(state.query ?? ""));
  const searchRef = useRef<HTMLInputElement>(null);
  // Reset transient list state when the view changes (folder, search or tab).
  const viewKey = `${state.folder}|${state.query ?? ""}|${state.tab ?? ""}`;
  const [seenView, setSeenView] = useState(viewKey);
  if (seenView !== viewKey) {
    setSeenView(viewKey);
    setSearchText(state.query ?? "");
    setSelected(new Set());
    setCursor(-1);
  }

  useInboxDelta(list.isSuccess);
  const inboxUnread = folders.data?.find((f) => (f.wellKnownName ?? "").toLowerCase() === "inbox")?.unreadItemCount ?? 0;
  useEffect(() => {
    document.title = inboxUnread > 0 ? `Inbox (${inboxUnread}) - Outlook` : "Inbox - Outlook";
  }, [inboxUnread]);

  // ---- selection helpers
  const idsOf = (t: Thread) => t.messages.map((m) => m.id);
  const selectedIds = () => threads.filter((t) => selected.has(t.conversationId)).flatMap(idsOf);
  const toggleSelect = (t: Thread) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(t.conversationId)) n.delete(t.conversationId);
      else n.add(t.conversationId);
      return n;
    });
  const bulk = (fn: (ids: string[]) => void) => () => {
    const ids = selectedIds();
    if (ids.length) fn(ids);
    setSelected(new Set());
  };

  const openThread = (t: Thread) => {
    if (t.latest.isDraft && t.messages.length === 1) {
      void openDraft(t.latest);
      return;
    }
    nav({ conversation: t.conversationId, message: undefined });
  };

  // ---- compose
  const openDraft = async (m: Message) => {
    try {
      const full = await draftApi.get(m.id);
      const atts = full.hasAttachments ? await draftApi.listAttachments(m.id) : [];
      setCompose(draftFromMessage(full, "new", atts));
    } catch (e) {
      toast.error(`Could not open draft. ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const startReply = async (kind: ReplyKind, m: Message) => {
    try {
      const draft = await draftApi.reply(m.id, kind);
      const atts = kind === "createForward" && draft.hasAttachments ? await draftApi.listAttachments(draft.id) : [];
      setCompose(draftFromMessage(draft, kind === "createForward" ? "forward" : "reply", atts));
      void qc.invalidateQueries({ queryKey: ["mail", "list", "drafts"] });
    } catch (e) {
      toast.error(`Could not start a reply. ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const queueSend = (d: ComposeDraft) => {
    setCompose(null);
    const id = d.draftId!;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        await draftApi.send(id);
        rememberRecipients([...d.to, ...d.cc, ...d.bcc]);
        toast.success("Message sent");
      } catch (e) {
        toast.error(`Send failed. The draft is kept in Drafts. ${e instanceof Error ? e.message : String(e)}`);
      }
    }, UNDO_MS);
    toast("Sending", {
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          cancelled = true;
          window.clearTimeout(timer);
          setCompose({ ...d, key: `${d.key}-undo` });
        },
      },
    });
  };

  // ---- search
  const runSearch = (kql: string) => nav({ query: kql || undefined, conversation: undefined, message: undefined });

  // ---- shortcuts
  const focusedThread = cursor >= 0 ? threads[cursor] : undefined;
  const currentThread = state.conversation ? threads.find((t) => t.conversationId === state.conversation) : undefined;
  const target = state.conversation ? currentThread : focusedThread;
  const handlers = useMemo(
    () => ({
      next: () => setCursor((c) => Math.min(c + 1, threads.length - 1)),
      prev: () => setCursor((c) => Math.max(c - 1, 0)),
      open: () => focusedThread && openThread(focusedThread),
      back: () => state.conversation && nav({ conversation: undefined, message: undefined }),
      archive: () => target && !isTrashOrSpam && (actions.archive(idsOf(target)), state.conversation && nav({ conversation: undefined })),
      trash: () => target && (actions.trash(idsOf(target)), state.conversation && nav({ conversation: undefined })),
      reply: () => target && void startReply("createReply", target.latest),
      replyAll: () => target && void startReply("createReplyAll", target.latest),
      forward: () => target && void startReply("createForward", target.latest),
      compose: () => setCompose({ key: String(Date.now()), to: [], cc: [], bcc: [], subject: "", body: "", attachments: [], kind: "new" }),
      star: () => target && actions.setStar(target.starred ? idsOf(target) : [target.latest.id], !target.starred),
      markRead: () => target && actions.setRead(idsOf(target), true),
      markUnread: () => target && actions.setRead(idsOf(target), false),
      select: () => focusedThread && toggleSelect(focusedThread),
      search: () => searchRef.current?.focus(),
      help: () => setHelp((h) => !h),
      escape: () => (help ? setHelp(false) : state.conversation ? nav({ conversation: undefined, message: undefined }) : setSelected(new Set())),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threads, focusedThread, target, state.conversation, isTrashOrSpam, help]
  );
  useMailShortcuts(handlers, !compose);

  const folderLabel = WELL_KNOWN_LABEL[state.folder as WellKnown] ?? folders.data?.find((f) => f.id === state.folder)?.displayName ?? "Mail";
  const catList = categories.data ?? [];

  return (
    <div className="flex h-screen min-w-0 bg-background">
      <FolderPanel
        active={state.folder}
        onSelect={(key) => {
          nav({ folder: key, conversation: undefined, message: undefined, query: undefined, tab: undefined });
          setNavOpen(false);
        }}
        onCompose={handlers.compose}
        className={cn("md:flex", navOpen ? "fixed inset-y-0 left-[72px] z-30 flex border-r border-border shadow-xl" : "hidden")}
      />
      {navOpen && <div className="fixed inset-0 z-20 bg-black/20 md:hidden" onClick={() => setNavOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2 px-4">
          <button type="button" aria-label="Folders" onClick={() => setNavOpen((o) => !o)} className="rounded-full p-2 hover:bg-black/10 md:hidden"><Menu className="h-5 w-5" /></button>
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(searchText.trim());
            }}
            className="flex h-12 max-w-3xl flex-1 items-center gap-2 rounded-full bg-muted px-4 focus-within:bg-card focus-within:shadow-md"
          >
            <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
            <input ref={searchRef} value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search mail" aria-label="Search mail" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            {searchText && (
              <button type="button" aria-label="Clear search" onClick={() => { setSearchText(""); if (state.query) runSearch(""); }} className="rounded-full p-1 hover:bg-black/10"><X className="h-4 w-4" /></button>
            )}
            <Popover>
              <PopoverTrigger render={<button type="button" aria-label="Search options" className="rounded-full p-1 text-muted-foreground hover:bg-black/10" />}>
                <SlidersHorizontal className="h-4 w-4" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <div className="grid grid-cols-[4rem_1fr] items-center gap-2 text-sm">
                  <label htmlFor="adv-from">From</label><Input id="adv-from" value={adv.from ?? ""} onChange={(e) => setAdv({ ...adv, from: e.target.value })} />
                  <label htmlFor="adv-to">To</label><Input id="adv-to" value={adv.to ?? ""} onChange={(e) => setAdv({ ...adv, to: e.target.value })} />
                  <label htmlFor="adv-subject">Subject</label><Input id="adv-subject" value={adv.subject ?? ""} onChange={(e) => setAdv({ ...adv, subject: e.target.value })} />
                  <label htmlFor="adv-text">Has words</label><Input id="adv-text" value={adv.text ?? ""} onChange={(e) => setAdv({ ...adv, text: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!adv.hasAttachment} onChange={(e) => setAdv({ ...adv, hasAttachment: e.target.checked })} /> Has attachment</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!adv.unread} onChange={(e) => setAdv({ ...adv, unread: e.target.checked })} /> Unread only</label>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setAdv({})}>Reset</Button>
                  <Button size="sm" onClick={() => { const k = buildKql(adv); setSearchText(k); runSearch(k); }}>Search</Button>
                </div>
              </PopoverContent>
            </Popover>
          </form>
          {folders.isSuccess && (
            <span className="ml-auto hidden text-xs text-muted-foreground lg:block">{inboxUnread > 0 ? `${inboxUnread} unread in Inbox` : "Inbox up to date"}</span>
          )}
        </header>
        <main className="mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
          {state.conversation ? (
            <ThreadView
              key={state.conversation}
              conversationId={state.conversation}
              messageId={state.message}
              currentFolder={state.folder}
              folders={folders.data ?? []}
              categories={catList}
              onBack={() => nav({ conversation: undefined, message: undefined })}
              onReply={startReply}
              onOpenDraft={(m) => { nav({ conversation: undefined, message: undefined }, true); void openDraft(m); }}
            />
          ) : (
            <>
              <ListToolbar
                total={threads.length}
                selectedCount={selected.size}
                allSelected={selected.size > 0 && selected.size === threads.length}
                onSelectAll={() => setSelected(new Set(threads.map((t) => t.conversationId)))}
                onClear={() => setSelected(new Set())}
                onRefresh={() => void list.refetch()}
                refreshing={list.isRefetching}
                onArchive={bulk(actions.archive)}
                onTrash={bulk((ids) => (isTrashOrSpam ? actions.deleteForever(ids) : actions.trash(ids)))}
                onSpam={bulk(actions.spam)}
                onInbox={bulk(actions.inbox)}
                onRead={bulk((ids) => actions.setRead(ids, true))}
                onUnread={bulk((ids) => actions.setRead(ids, false))}
                onLabel={
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger render={<DropdownMenuTrigger render={<button aria-label="Label as" className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-black/10 hover:text-foreground" />} />}>
                        <Tag className="h-4 w-4" />
                      </TooltipTrigger>
                      <TooltipContent>Label as</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent>
                      <DropdownMenuLabel>Label as</DropdownMenuLabel>
                      {catList.map((c) => {
                        const sel = threads.filter((t) => selected.has(t.conversationId));
                        const all = sel.length > 0 && sel.every((t) => t.categories.includes(c.displayName));
                        return (
                          <DropdownMenuCheckboxItem
                            key={c.id}
                            checked={all}
                            onCheckedChange={() => {
                              for (const t of sel) for (const m of t.messages) {
                                const cur = m.categories ?? [];
                                actions.setCategories([m.id], all ? cur.filter((x) => x !== c.displayName) : Array.from(new Set([...cur, c.displayName])));
                              }
                            }}
                          >
                            <span className="mr-1 h-2.5 w-2.5 rounded-full" style={{ background: presetHex(c.color) }} /> {c.displayName}
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
                page={state.query ? `${threads.length} results` : `${threads.length}${list.hasNextPage ? "+" : ""} in ${folderLabel}`}
                onPrev={() => setCursor(0)}
                onNext={() => void list.fetchNextPage()}
                hasPrev={cursor > 0}
                hasNext={!!list.hasNextPage}
                isTrashOrSpam={isTrashOrSpam}
              />
              {isInbox && (
                <div className="flex shrink-0 border-b border-border" role="tablist" aria-label="Inbox tabs">
                  {(["focused", "other"] as const).map((t) => (
                    <button key={t} role="tab" aria-selected={tab === t} onClick={() => nav({ tab: t }, true)} className={cn("relative h-11 w-40 text-sm font-medium text-muted-foreground hover:bg-muted/60", tab === t && "text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary")}>
                      {t === "focused" ? "Primary" : "Other"}
                    </button>
                  ))}
                </div>
              )}
              {list.isPending && <ListSkeleton />}
              {list.isError && <MailErrorState error={list.error} onRetry={() => list.refetch()} />}
              {list.isSuccess && threads.length === 0 && <EmptyList folder={state.folder} query={state.query} />}
              {list.isSuccess && threads.length > 0 && (
                <MessageList
                  threads={threads}
                  selected={selected}
                  cursor={cursor}
                  meAddress={meAddress}
                  categories={catList}
                  onOpen={openThread}
                  onToggleSelect={toggleSelect}
                  actions={actions}
                  hasMore={list.hasNextPage}
                  loadMore={() => void list.fetchNextPage()}
                  isFetchingMore={list.isFetchingNextPage}
                  isTrashOrSpam={isTrashOrSpam}
                />
              )}
            </>
          )}
        </main>
      </div>
      {compose && (
        <ComposeDrawer key={compose.key} draft={compose} onClose={() => { setCompose(null); void qc.invalidateQueries({ queryKey: ["mail", "list", "drafts"] }); }} onSend={queueSend} onDiscard={() => { setCompose(null); toast.success("Draft discarded"); }} />
      )}
      <ShortcutHelp open={help} onOpenChange={setHelp} />
    </div>
  );
}
