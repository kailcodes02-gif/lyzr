"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Menu, MoreVertical, Search, SlidersHorizontal, Tag, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMe } from "@/lib/hooks";
import { clientFilterFor, errorMessage, flattenPages, useCategories, useDraftApi, useEnableSorting, useFolders, useMailPolling, useMessageActions, useMessageList, useSettlerLifecycle, useSortingEnabled } from "@/lib/mail/hooks";
import { PROMOTIONS_LABEL, SOCIAL_LABEL } from "@/lib/mail/labels";
import { TAB_LABEL, type TabTarget } from "@/lib/mail/tabs";
import { buildKql, groupThreads, isVirtualFolderKey, moveScopeIds, parseKql, presetHex, resolveFolderId, SEARCH_ID, WELL_KNOWN_LABEL, type WellKnown } from "@/lib/mail/logic";
import type { Message, Thread } from "@/lib/mail/types";
import { labelFromFolder, parseMailUrl, serializeMailUrl, type MailTab, type MailUrlState } from "@/lib/mail/url";
import { isMockMode } from "@/lib/mock";
import { rememberRecipients } from "@/lib/people";
import { cn } from "@/lib/utils";
import { ComposeDrawer, draftFromMessage, type ComposeDraft } from "./compose";
import { MailErrorState } from "./consent-gate";
import { FolderPanel } from "./folder-panel";
import { LabelDialog, type LabelDialogState } from "./label-dialog";
import { EmptyList, ListSkeleton, ListToolbar, MessageList, THREAD_DRAG_TYPE } from "./message-list";
import { ShortcutHelp, useMailShortcuts } from "./shortcuts";
import { ThreadView, type ReplyKind } from "./thread-view";

const UNDO_MS = 5000;

// Drafts whose undo window was running when the page went away; sent on the
// next load so "Sending" never silently ends as a draft.
const PENDING_KEY = "msui.mail.pendingSends";
function readPending(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function writePending(ids: string[]) {
  try {
    if (ids.length) sessionStorage.setItem(PENDING_KEY, JSON.stringify(ids));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // storage blocked
  }
}

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
  const tab: MailTab | undefined = isInbox ? (state.tab ?? "primary") : undefined;
  const labelName = labelFromFolder(state.folder);
  const list = useMessageList(state.folder, tab, state.query, state.focused);
  // Label views list every folder; Trash and Junk copies are dropped here.
  const hiddenFolderIds = useMemo(() => new Set(["deleteditems", "junkemail"].map((k) => resolveFolderId(k, folders.data ?? [])).filter((id): id is string => !!id)), [folders.data]);
  const clientFilter = clientFilterFor({ folder: state.folder, tab, query: state.query, focused: state.focused }, hiddenFolderIds);
  const messages = useMemo(() => {
    const all = flattenPages(list.data);
    return clientFilter ? all.filter(clientFilter) : all;
  }, [list.data, clientFilter]);
  const threads = useMemo(() => groupThreads(messages), [messages]);
  const isTrashOrSpam = state.folder === "deleteditems" || state.folder === "junkemail";
  const isSpam = state.folder === "junkemail";
  // Client-side exclusion can leave a short first page: keep fetching until 50 rows show.
  useEffect(() => {
    if (clientFilter && list.hasNextPage && !list.isFetchingNextPage && messages.length < 50) void list.fetchNextPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter, list.hasNextPage, list.isFetchingNextPage, messages.length]);
  const sortingOn = useSortingEnabled();
  const enableSorting = useEnableSorting();
  const [labelDialog, setLabelDialog] = useState<LabelDialogState | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const selectTab = (t: MailTab) => {
    if (t !== "primary" && sortingOn === false && !enableSorting.isPending) enableSorting.mutate();
    nav({ tab: t }, true);
  };
  const openSortingSettings = (name: string) => {
    const cat = (categories.data ?? []).find((c) => c.displayName === name);
    if (cat) setLabelDialog({ mode: "edit", category: cat });
    else enableSorting.mutate(undefined, { onSuccess: () => void categories.refetch() });
  };

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(-1);
  const [help, setHelp] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeDraft | null>(null);
  const [searchText, setSearchText] = useState(state.query ?? "");
  const [adv, setAdv] = useState(() => parseKql(state.query ?? ""));
  const searchRef = useRef<HTMLInputElement>(null);
  // Reset transient list state when the view changes (folder, search or tab).
  const viewKey = `${state.folder}|${state.query ?? ""}|${state.tab ?? ""}|${state.focused ? 1 : 0}`;
  const [seenView, setSeenView] = useState(viewKey);
  if (seenView !== viewKey) {
    setSeenView(viewKey);
    setSearchText(state.query ?? "");
    setSelected(new Set());
    setCursor(-1);
  }

  // Every action's settle timers die with this screen; the open view is
  // polled while the tab is visible.
  useSettlerLifecycle();
  const polling = useMailPolling({ folder: state.folder, tab, query: state.query, focused: state.focused }, list.isSuccess);
  const updatedAt = Math.max(list.dataUpdatedAt ?? 0, polling.lastPolledAt);
  // Content stays on screen through every background refetch (and, while a
  // new view loads, the previous view's rows sit dimmed under aria-busy).
  const showList = !!list.data;
  const inboxUnread = folders.data?.find((f) => (f.wellKnownName ?? "").toLowerCase() === "inbox")?.unreadItemCount ?? 0;

  // ---- selection helpers
  const idsOf = (t: Thread) => t.messages.map((m) => m.id);
  const selectedIds = () => threads.filter((t) => selected.has(t.conversationId)).flatMap(idsOf);
  // Move-type actions: rows of a real folder are already scoped; virtual
  // views (starred, label, search) list copies from every folder, so
  // Sent/Drafts/Trash/Junk siblings are left alone.
  const scopeKey = state.query ? SEARCH_ID : state.folder;
  const moveIdsOf = (t: Thread) => (isVirtualFolderKey(scopeKey) ? moveScopeIds(t.messages, scopeKey, folders.data ?? []) : idsOf(t));
  const selectedThreads = () => threads.filter((t) => selected.has(t.conversationId));
  const selectedMoveIds = () => selectedThreads().flatMap(moveIdsOf);
  const currentFolderId = resolveFolderId(state.folder, folders.data ?? []);
  const toggleSelect = (t: Thread) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(t.conversationId)) n.delete(t.conversationId);
      else n.add(t.conversationId);
      return n;
    });
  const bulk = (fn: (ids: string[], conversations: number) => void, scope: "all" | "move" = "all") => () => {
    const ids = scope === "move" ? selectedMoveIds() : selectedIds();
    if (ids.length) fn(ids, selected.size);
    setSelected(new Set());
  };
  const bulkDelete = () => {
    if (!isTrashOrSpam) return bulk(actions.trash, "move")();
    const ids = selectedMoveIds();
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length === 1 ? "this message" : `these ${ids.length} messages`} forever? This cannot be undone.`)) return;
    actions.deleteForever(ids, currentFolderId);
    setSelected(new Set());
  };

  // Bulk "Move to tab": every selected message that sits in the Inbox.
  const bulkMoveToTab = (target: TabTarget) => {
    const inboxId = resolveFolderId("inbox", folders.data ?? []);
    const msgs = selectedThreads().flatMap((t) => t.messages).filter((m) => !m.isDraft && (!inboxId || m.parentFolderId === inboxId));
    actions.moveToTab(msgs, target);
    setSelected(new Set());
  };
  // A list row dragged onto a tab.
  const [dropTab, setDropTab] = useState<TabTarget | null>(null);
  const dropOnTab = (e: React.DragEvent, target: TabTarget) => {
    e.preventDefault();
    setDropTab(null);
    const id = e.dataTransfer.getData(THREAD_DRAG_TYPE);
    const t = threads.find((x) => x.conversationId === id);
    if (t) actions.moveToTab(t.messages.filter((m) => !m.isDraft), target);
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
  const sendNow = async (id: string, recipients: { name?: string; email: string }[] = [], subject?: string) => {
    try {
      await draftApi.send(id, { subject });
      // Demo recipients must not seed the real composer's suggestions.
      if (!isMockMode()) rememberRecipients(recipients);
      toast.success("Sent");
    } catch (e) {
      toast.error(`Send failed. The draft is kept in Drafts. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      writePending(readPending().filter((x) => x !== id));
    }
  };
  const pendingTimers = useRef(new Map<string, number>());
  const queueSend = (d: ComposeDraft) => {
    setCompose(null);
    const id = d.draftId!;
    writePending([...readPending(), id]);
    const timer = window.setTimeout(() => {
      pendingTimers.current.delete(id);
      void sendNow(id, [...d.to, ...d.cc, ...d.bcc], d.subject);
    }, UNDO_MS);
    pendingTimers.current.set(id, timer);
    toast("Sending", {
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          window.clearTimeout(timer);
          pendingTimers.current.delete(id);
          writePending(readPending().filter((x) => x !== id));
          draftApi.undoSend(id);
          setCompose({ ...d, key: `${d.key}-undo` });
        },
      },
    });
  };
  // Leaving the page inside the undo window sends at once; anything that
  // still did not go out is sent on the next visit.
  useEffect(() => {
    const flush = () => {
      for (const [id, timer] of pendingTimers.current) {
        window.clearTimeout(timer);
        void sendNow(id);
      }
      pendingTimers.current.clear();
    };
    window.addEventListener("pagehide", flush);
    for (const id of readPending()) void sendNow(id);
    return () => window.removeEventListener("pagehide", flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- search: the plain box goes through the same normaliser as the
  // advanced form, so a typed quote never reaches Graph's $search grammar.
  const runSearch = (kql: string) => nav({ query: kql || undefined, conversation: undefined, message: undefined });
  const runTextSearch = (text: string) => runSearch(buildKql({ text }));

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
      archive: () => target && !isTrashOrSpam && moveIdsOf(target).length && (actions.archive(moveIdsOf(target)), state.conversation && nav({ conversation: undefined })),
      trash: () => target && moveIdsOf(target).length && (actions.trash(moveIdsOf(target)), state.conversation && nav({ conversation: undefined })),
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
    [threads, focusedThread, target, state.conversation, isTrashOrSpam, help, folders.data, scopeKey]
  );
  useMailShortcuts(handlers, !compose);

  const catList = categories.data ?? [];
  const activeCategory = labelName ? catList.find((c) => c.displayName.toLowerCase() === labelName.toLowerCase()) : undefined;
  const folderLabel = labelName ?? WELL_KNOWN_LABEL[state.folder as WellKnown] ?? folders.data?.find((f) => f.id === state.folder)?.displayName ?? "Mail";

  // Tab title follows the view (unread count only on the Inbox) and is put
  // back when the Outlook screen unmounts.
  const titleSubject = currentThread?.latest.subject;
  useEffect(() => {
    const view = state.conversation ? (titleSubject || folderLabel) : state.query ? `Search: ${state.query}` : isInbox && inboxUnread > 0 ? `Inbox (${inboxUnread})` : folderLabel;
    document.title = `${view} - Outlook`;
  }, [state.conversation, state.query, titleSubject, isInbox, inboxUnread, folderLabel]);
  useEffect(() => {
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="flex h-screen min-w-0 bg-background">
      <FolderPanel
        active={state.folder}
        onSelect={(key) => {
          nav({ folder: key, conversation: undefined, message: undefined, query: undefined, tab: undefined });
          setNavOpen(false);
        }}
        onCompose={handlers.compose}
        meAddress={meAddress}
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
              runTextSearch(searchText);
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
                <label className="flex items-center justify-between gap-2 border-t border-border pt-2 text-sm">
                  <span>Focused only <span className="text-xs text-muted-foreground">(Outlook Focused inbox)</span></span>
                  <Switch checked={!!state.focused} onCheckedChange={(v) => nav({ focused: v || undefined }, true)} aria-label="Focused only" />
                </label>
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
              currentFolder={scopeKey}
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
                onRefresh={polling.refresh}
                refreshing={list.isRefetching}
                updatedAt={updatedAt}
                onArchive={bulk(actions.archive, "move")}
                onTrash={bulkDelete}
                onSpam={bulk(actions.spam, "move")}
                onNotSpam={isSpam ? bulk(actions.notSpam, "move") : undefined}
                onMoveToTab={isInbox ? bulkMoveToTab : undefined}
                onInbox={bulk(actions.inbox, "move")}
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
                    <DropdownMenuContent><DropdownMenuGroup>
                      <DropdownMenuLabel>Label as</DropdownMenuLabel>
                      {catList.map((c) => {
                        const sel = threads.filter((t) => selected.has(t.conversationId));
                        const all = sel.length > 0 && sel.every((t) => t.categories.includes(c.displayName));
                        return (
                          <DropdownMenuCheckboxItem
                            key={c.id}
                            checked={all}
                            onCheckedChange={() => {
                              actions.setCategoriesMany(
                                sel.flatMap((t) => t.messages).map((m) => {
                                  const cur = m.categories ?? [];
                                  return { id: m.id, categories: all ? cur.filter((x) => x !== c.displayName) : Array.from(new Set([...cur, c.displayName])) };
                                })
                              );
                            }}
                          >
                            <span className="mr-1 h-2.5 w-2.5 rounded-full" style={{ background: presetHex(c.color) }} /> {c.displayName}
                          </DropdownMenuCheckboxItem>
                        );
                      })}</DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
                page={
                  state.query ? (
                    `${threads.length} results`
                  ) : labelName ? (
                    <span className="inline-flex items-center gap-1.5" aria-label={`Label view ${labelName}`}>
                      <span className="inline-flex items-center rounded-sm px-1.5 text-[11px] font-medium text-white" style={{ background: presetHex(activeCategory?.color) }}>{labelName}</span>
                      {threads.length}{list.hasNextPage ? "+" : ""} conversations
                    </span>
                  ) : (
                    `${threads.length}${list.hasNextPage ? "+" : ""} in ${folderLabel}`
                  )
                }
                onPrev={() => setCursor(0)}
                onNext={() => void list.fetchNextPage()}
                hasPrev={cursor > 0}
                hasNext={!!list.hasNextPage}
                isTrashOrSpam={isTrashOrSpam}
                isSpam={isSpam}
              />
              {isInbox && (
                <div className="flex shrink-0 items-center border-b border-border" role="tablist" aria-label="Inbox tabs">
                  {(["primary", "social", "promotions"] as const).map((t) => (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={tab === t}
                      onClick={() => selectTab(t)}
                      onDragOver={(e) => {
                        if (!e.dataTransfer.types.includes(THREAD_DRAG_TYPE)) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dropTab !== t) setDropTab(t);
                      }}
                      onDragLeave={() => dropTab === t && setDropTab(null)}
                      onDrop={(e) => dropOnTab(e, t)}
                      data-drop-target={dropTab === t || undefined}
                      title={`Drop a conversation here to move it to ${TAB_LABEL[t]}`}
                      className={cn("relative h-11 w-36 text-sm font-medium uppercase tracking-wide text-muted-foreground hover:bg-muted/60", tab === t && "text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary", dropTab === t && "bg-accent/60 ring-2 ring-inset ring-primary")}
                    >
                      {t}
                    </button>
                  ))}
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<button type="button" aria-label="Tab options" className="ml-auto mr-2 rounded-full p-1.5 text-muted-foreground hover:bg-black/10" />}>
                      <MoreVertical className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end"><DropdownMenuGroup>
                      <DropdownMenuLabel>Sorting settings</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => openSortingSettings(SOCIAL_LABEL)}>Social senders</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openSortingSettings(PROMOTIONS_LABEL)}>Promotions senders</DropdownMenuItem>
                      {sortingOn === false && <DropdownMenuItem onClick={() => enableSorting.mutate()}>Turn on inbox sorting</DropdownMenuItem>}</DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              {isInbox && tab === "primary" && sortingOn === false && !bannerDismissed && (
                <div className="flex shrink-0 items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 text-sm" role="status">
                  <span className="flex-1">Sort social updates and newsletters out of Primary. Creates two Outlook rules and the Social and Promotions labels.</span>
                  {enableSorting.progressLabel && <span className="text-xs text-muted-foreground" aria-live="polite">{enableSorting.progressLabel}</span>}
                  <Button size="sm" onClick={() => enableSorting.mutate()} disabled={enableSorting.isPending}>{enableSorting.isPending ? "Sorting" : "Turn on inbox sorting"}</Button>
                  <button type="button" aria-label="Dismiss" onClick={() => setBannerDismissed(true)} className="rounded-full p-1 hover:bg-black/10"><X className="h-4 w-4" /></button>
                </div>
              )}
              {isInbox && tab !== "primary" && enableSorting.isPending && <p className="px-4 py-2 text-xs text-muted-foreground" aria-live="polite">{enableSorting.progressLabel ?? "Setting up inbox sorting"}</p>}
              {list.isPending && !list.isError && <ListSkeleton />}
              {list.isError && !list.data && <MailErrorState error={list.error} onRetry={() => list.refetch()} />}
              {list.isError && list.data && (
                <p className="flex items-center gap-2 border-b border-border bg-destructive/5 px-4 py-1.5 text-xs text-destructive" role="alert">
                  Could not refresh. {errorMessage(list.error)}
                  <button type="button" className="underline underline-offset-2" onClick={() => void list.refetch()}>Retry</button>
                </p>
              )}
              {showList && threads.length === 0 && !list.isPlaceholderData && <EmptyList folder={state.folder} query={state.query} />}
              {showList && threads.length > 0 && (
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
                  isSpam={isSpam}
                  showTabs={isInbox}
                  busy={list.isPlaceholderData}
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
      <LabelDialog state={labelDialog} onClose={() => setLabelDialog(null)} meAddress={meAddress} />
    </div>
  );
}
