"use client";

import { Archive, ArrowLeft, ChevronDown, Download, ExternalLink, FolderInput, Forward, Mail, MoreVertical, Paperclip, Reply, ReplyAll, ShieldAlert, Star, Tag, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fileKind, KIND_COLOR, KIND_LABEL } from "@/lib/files";
import { formatDateTime, initials } from "@/lib/format";
import { useAttachments, useCreateRule, useDownloadAttachment, useMessage, useMessageActions, useThread } from "@/lib/mail/hooks";
import { orderFolders, presetHex, recipientsLabel, sortMessagesAsc, visibleFolders, WELL_KNOWN_LABEL, type WellKnown } from "@/lib/mail/logic";
import type { Attachment, MailFolder, Message, OutlookCategory } from "@/lib/mail/types";
import { cn } from "@/lib/utils";
import { EmailFrame } from "./email-frame";
import { MailErrorState } from "./consent-gate";

export type ReplyKind = "createReply" | "createReplyAll" | "createForward";

function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function fmtSize(n?: number) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentChip({ messageId, att }: { messageId: string; att: Attachment }) {
  const download = useDownloadAttachment();
  const [busy, setBusy] = useState(false);
  const kind = fileKind(att.name, att.contentType);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const url = await download(messageId, att);
          const a = document.createElement("a");
          a.href = url;
          a.download = att.name;
          a.target = "_blank";
          a.rel = "noopener";
          a.click();
        } finally {
          setBusy(false);
        }
      }}
      className="flex max-w-64 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs hover:bg-muted"
    >
      <Paperclip className={cn("h-4 w-4 shrink-0", KIND_COLOR[kind])} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{att.name}</span>
        <span className="text-muted-foreground">
          {KIND_LABEL[kind]}
          {att.size ? ` · ${fmtSize(att.size)}` : ""}
        </span>
      </span>
      <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

function MessageCard({ message, expanded, onToggle, onReply, categories, isLast }: { message: Message; expanded: boolean; onToggle: () => void; onReply: (kind: ReplyKind, m: Message) => void; categories?: OutlookCategory[]; isLast: boolean }) {
  const full = useMessage(expanded ? message.id : undefined);
  const attachments = useAttachments(message.id, expanded && (!!message.hasAttachments || /cid:/i.test(full.data?.body?.content ?? "")));
  const download = useDownloadAttachment();
  const [showQuoted, setShowQuoted] = useState(false);
  const [cidMap, setCidMap] = useState<Record<string, string>>({});
  const actions = useMessageActions();
  const starred = message.flag?.flagStatus === "flagged";

  const inline = useMemo(() => (attachments.data ?? []).filter((a) => a.isInline && a.contentId), [attachments.data]);
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      const next: Record<string, string> = {};
      for (const a of inline) {
        try {
          const u = await download(message.id, a);
          urls.push(u);
          next[a.contentId!.replace(/^<|>$/g, "")] = u;
        } catch {
          // leave placeholder
        }
      }
      if (!cancelled && Object.keys(next).length) setCidMap(next);
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => u.startsWith("blob:") && URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline, message.id]);

  const data = full.data;
  const hasQuoted = !!data?.uniqueBody && !!data.body && data.uniqueBody.content.trim() !== data.body.content.trim();
  const body = showQuoted || !hasQuoted ? data?.body : data?.uniqueBody;
  const from = message.from?.emailAddress;
  const senderKey = (from?.address ?? "").toLowerCase();
  const colorOf = (name: string) => presetHex(categories?.find((c) => c.displayName === name)?.color);

  return (
    <article className={cn("border-b border-border bg-card", isLast && "border-b-0")} data-expanded={expanded}>
      <header className={cn("flex cursor-pointer items-start gap-3 px-4 py-3", !expanded && "hover:bg-muted/50")} onClick={onToggle}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold" aria-hidden>
          {initials(from?.name) || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cn("truncate text-sm", message.isRead === false ? "font-semibold" : "font-medium")}>{from?.name || from?.address || "Unknown sender"}</span>
            {expanded && <span className="truncate text-xs text-muted-foreground">&lt;{from?.address}&gt;</span>}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatDateTime(message.receivedDateTime)}</span>
            {expanded && (
              <span className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                <Tip label={starred ? "Unstar" : "Star"}>
                  <button type="button" aria-label={starred ? "Unstar" : "Star"} onClick={() => actions.setStar([message.id], !starred)} className="rounded-full p-1 hover:bg-black/10">
                    <Star className={cn("h-4 w-4", starred ? "fill-[#f4b400] text-[#f4b400]" : "text-muted-foreground")} />
                  </button>
                </Tip>
                <Tip label="Reply">
                  <button type="button" aria-label="Reply" onClick={() => onReply("createReply", message)} className="rounded-full p-1 hover:bg-black/10">
                    <Reply className="h-4 w-4 text-muted-foreground" />
                  </button>
                </Tip>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<button aria-label="More" className="rounded-full p-1 hover:bg-black/10" />}>
                    <MoreVertical className="h-4 w-4 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onReply("createReplyAll", message)}><ReplyAll /> Reply all</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onReply("createForward", message)}><Forward /> Forward</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => actions.setRead([message.id], false)}><Mail /> Mark as unread</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => actions.trash([message.id])}><Trash2 /> Delete this message</DropdownMenuItem>
                    {message.webLink && (
                      <DropdownMenuItem onClick={() => window.open(message.webLink, "_blank", "noopener")}><ExternalLink /> Open in Outlook</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            )}
          </div>
          {expanded ? (
            <div className="truncate text-xs text-muted-foreground">
              to {recipientsLabel(message.toRecipients) || "me"}
              {message.ccRecipients?.length ? `, cc ${recipientsLabel(message.ccRecipients)}` : ""}
            </div>
          ) : (
            <div className="truncate text-xs text-muted-foreground">{message.bodyPreview}</div>
          )}
        </div>
      </header>
      {expanded && (
        <div className="px-4 pb-4 pl-16">
          {!!message.categories?.length && (
            <div className="mb-2 flex flex-wrap gap-1">
              {message.categories.map((c) => (
                <span key={c} className="rounded-sm px-1.5 text-[11px] font-medium text-white" style={{ background: colorOf(c) }}>{c}</span>
              ))}
            </div>
          )}
          {full.isPending && (
            <div className="space-y-2 py-2">
              <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
            </div>
          )}
          {full.isError && <p className="text-sm text-destructive">Could not load this message.</p>}
          {data && <EmailFrame body={body} cidMap={cidMap} senderKey={senderKey} />}
          {hasQuoted && (
            <button type="button" onClick={() => setShowQuoted((s) => !s)} aria-label={showQuoted ? "Hide quoted text" : "Show quoted text"} className="mt-1 rounded-full bg-muted px-2 py-0.5 text-xs leading-none text-muted-foreground hover:bg-black/10">
              ···
            </button>
          )}
          {!!attachments.data?.filter((a) => !a.isInline).length && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              {attachments.data.filter((a) => !a.isInline).map((a) => (
                <AttachmentChip key={a.id} messageId={message.id} att={a} />
              ))}
              {attachments.data.filter((a) => !a.isInline).length > 1 && (
                <button
                  type="button"
                  className="self-center text-xs text-primary hover:underline"
                  onClick={async () => {
                    for (const a of attachments.data!.filter((x) => !x.isInline)) {
                      const url = await download(message.id, a);
                      const el = document.createElement("a");
                      el.href = url;
                      el.download = a.name;
                      el.click();
                    }
                  }}
                >
                  Download all
                </button>
              )}
            </div>
          )}
          {isLast && (
            <div className="mt-4 flex gap-2">
              <Button variant="outline" className="rounded-full" onClick={() => onReply("createReply", message)}><Reply /> Reply</Button>
              <Button variant="outline" className="rounded-full" onClick={() => onReply("createReplyAll", message)}><ReplyAll /> Reply all</Button>
              <Button variant="outline" className="rounded-full" onClick={() => onReply("createForward", message)}><Forward /> Forward</Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function FilterDialog({ open, onOpenChange, sender, folders, categories }: { open: boolean; onOpenChange: (o: boolean) => void; sender: string; folders: MailFolder[]; categories: OutlookCategory[] }) {
  const create = useCreateRule();
  const [contains, setContains] = useState(sender);
  const [seenSender, setSeenSender] = useState(sender);
  if (seenSender !== sender) {
    setSeenSender(sender);
    setContains(sender);
  }
  const [folder, setFolder] = useState("");
  const [category, setCategory] = useState("");
  const [markRead, setMarkRead] = useState(false);
  const submit = () => {
    const actions: NonNullable<Parameters<typeof create.mutate>[0]["actions"]> = {};
    if (folder) actions.moveToFolder = folder;
    if (category) actions.assignCategories = [category];
    if (markRead) actions.markAsRead = true;
    create.mutate({ displayName: `From ${contains}`, sequence: 1, isEnabled: true, conditions: { senderContains: [contains] }, actions }, { onSuccess: () => onOpenChange(false) });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Filter messages like this</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">When the sender contains</span>
            <Input value={contains} onChange={(e) => setContains(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Move to folder</span>
            <select value={folder} onChange={(e) => setFolder(e.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm">
              <option value="">Keep in Inbox</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{WELL_KNOWN_LABEL[(f.wellKnownName ?? "").toLowerCase() as WellKnown] ?? f.displayName}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Apply label</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm">
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.displayName}>{c.displayName}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={markRead} onCheckedChange={(v) => setMarkRead(!!v)} /> Mark as read
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!contains.trim() || create.isPending || (!folder && !category && !markRead)}>Create filter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ThreadView({ conversationId, messageId, onBack, onReply, onOpenDraft, folders, categories, currentFolder }: { conversationId: string; messageId?: string; onBack: () => void; onReply: (kind: ReplyKind, m: Message) => void; onOpenDraft: (m: Message) => void; folders: MailFolder[]; categories: OutlookCategory[]; currentFolder: string }) {
  const thread = useThread(conversationId);
  const actions = useMessageActions();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const messages = useMemo(() => sortMessagesAsc(thread.data ?? []), [thread.data]);
  const latest = messages[messages.length - 1];
  const ids = messages.map((m) => m.id);
  const unreadIds = messages.filter((m) => m.isRead === false).map((m) => m.id);
  const isTrashOrSpam = currentFolder === "deleteditems" || currentFolder === "junkemail";

  // Expand the requested message, else the latest; mark unread ones read on open.
  const defaultExpanded = messages.length ? (messageId && messages.some((m) => m.id === messageId) ? messageId : messages[messages.length - 1].id) : undefined;
  const isExpanded = (id: string) => (expanded.size ? expanded.has(id) : id === defaultExpanded);
  useEffect(() => {
    if (unreadIds.length) actions.setRead(unreadIds, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, thread.dataUpdatedAt]);
  // A draft-only conversation opens straight in the composer.
  useEffect(() => {
    if (messages.length === 1 && messages[0].isDraft) onOpenDraft(messages[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const allStarred = messages.length > 0 && messages.every((m) => m.flag?.flagStatus === "flagged");
  const anyStarred = messages.some((m) => m.flag?.flagStatus === "flagged");
  const threadCategories = Array.from(new Set(messages.flatMap((m) => m.categories ?? [])));
  const toggleCategory = (name: string) => {
    const has = threadCategories.includes(name);
    for (const m of messages) {
      const cur = m.categories ?? [];
      const next = has ? cur.filter((c) => c !== name) : Array.from(new Set([...cur, name]));
      if (next.length !== cur.length) actions.setCategories([m.id], next);
    }
  };
  const moveTargets = orderFolders(visibleFolders(folders)).filter((f) => !["inbox", "sentitems", "drafts", "deleteditems", "junkemail", "outbox"].includes((f.wellKnownName ?? "").toLowerCase()));
  const doThen = (fn: () => void) => () => {
    fn();
    onBack();
  };

  const tb = "flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
        <Tip label="Back to list"><button type="button" aria-label="Back to list" onClick={onBack} className={tb}><ArrowLeft className="h-4 w-4" /></button></Tip>
        {!isTrashOrSpam && <Tip label="Archive"><button type="button" aria-label="Archive" onClick={doThen(() => actions.archive(ids))} className={tb}><Archive className="h-4 w-4" /></button></Tip>}
        {!isTrashOrSpam && <Tip label="Report spam"><button type="button" aria-label="Report spam" onClick={doThen(() => actions.spam(ids))} className={tb}><ShieldAlert className="h-4 w-4" /></button></Tip>}
        <Tip label={isTrashOrSpam ? "Delete forever" : "Delete"}><button type="button" aria-label="Delete" onClick={doThen(() => (isTrashOrSpam ? actions.deleteForever(ids) : actions.trash(ids)))} className={tb}><Trash2 className="h-4 w-4" /></button></Tip>
        <span className="mx-1 h-5 w-px bg-border" />
        <Tip label="Mark as unread"><button type="button" aria-label="Mark as unread" onClick={doThen(() => actions.setRead(ids, false))} className={tb}><Mail className="h-4 w-4" /></button></Tip>
        <Tip label={allStarred ? "Unstar" : "Star"}><button type="button" aria-label={allStarred ? "Unstar" : "Star"} onClick={() => actions.setStar(allStarred || !anyStarred ? ids : [latest.id], !allStarred)} className={tb}><Star className={cn("h-4 w-4", anyStarred && "fill-[#f4b400] text-[#f4b400]")} /></button></Tip>
        <DropdownMenu>
          <Tip label="Move to"><DropdownMenuTrigger render={<button aria-label="Move to" className={tb} />}><FolderInput className="h-4 w-4" /></DropdownMenuTrigger></Tip>
          <DropdownMenuContent>
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            {isTrashOrSpam && <DropdownMenuItem onClick={doThen(() => actions.inbox(ids))}>Inbox</DropdownMenuItem>}
            {moveTargets.map((f) => (
              <DropdownMenuItem key={f.id} onClick={doThen(() => actions.moveTo(ids, f.id, WELL_KNOWN_LABEL[(f.wellKnownName ?? "").toLowerCase() as WellKnown] ?? f.displayName))}>
                {WELL_KNOWN_LABEL[(f.wellKnownName ?? "").toLowerCase() as WellKnown] ?? f.displayName}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <Tip label="Labels"><DropdownMenuTrigger render={<button aria-label="Labels" className={tb} />}><Tag className="h-4 w-4" /></DropdownMenuTrigger></Tip>
          <DropdownMenuContent>
            <DropdownMenuLabel>Label as</DropdownMenuLabel>
            {categories.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">No labels yet</div>}
            {categories.map((c) => (
              <DropdownMenuCheckboxItem key={c.id} checked={threadCategories.includes(c.displayName)} onCheckedChange={() => toggleCategory(c.displayName)}>
                <span className="mr-1 h-2.5 w-2.5 rounded-full" style={{ background: presetHex(c.color) }} /> {c.displayName}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <Tip label="More"><DropdownMenuTrigger render={<button aria-label="More actions" className={tb} />}><MoreVertical className="h-4 w-4" /></DropdownMenuTrigger></Tip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setFilterOpen(true)}>Filter messages like this</DropdownMenuItem>
            {latest?.webLink && <DropdownMenuItem onClick={() => window.open(latest.webLink, "_blank", "noopener")}><ExternalLink /> Open in Outlook</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setExpanded(new Set(ids))}><ChevronDown /> Expand all</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ml-auto text-xs text-muted-foreground">{messages.length ? `${messages.length} of ${messages.length}` : ""}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {thread.isPending && (
          <div className="p-6">
            <div className="mb-4 h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-40 animate-pulse rounded-xl bg-muted" />
          </div>
        )}
        {thread.isError && <MailErrorState error={thread.error} onRetry={() => thread.refetch()} title="Could not load this conversation" />}
        {thread.data && messages.length === 0 && (
          <div className="p-10 text-center text-sm text-muted-foreground">This conversation is empty or was moved.</div>
        )}
        {messages.length > 0 && (
          <div className="mx-auto max-w-5xl px-4 py-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 px-4">
              <h1 className="text-xl font-normal">{latest?.subject || "(no subject)"}</h1>
              {threadCategories.map((c) => (
                <span key={c} className="rounded-sm px-1.5 text-[11px] font-medium text-white" style={{ background: presetHex(categories.find((x) => x.displayName === c)?.color) }}>{c}</span>
              ))}
            </div>
            <div className="overflow-hidden rounded-xl border border-border">
              {messages.map((m, i) => (
                <MessageCard
                  key={m.id}
                  message={m}
                  expanded={isExpanded(m.id)}
                  isLast={i === messages.length - 1}
                  categories={categories}
                  onReply={(kind, msg) => (msg.isDraft ? onOpenDraft(msg) : onReply(kind, msg))}
                  onToggle={() =>
                    setExpanded((s) => {
                      const n = new Set(s.size ? s : defaultExpanded ? [defaultExpanded] : []);
                      if (n.has(m.id)) n.delete(m.id);
                      else n.add(m.id);
                      return n;
                    })
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <FilterDialog open={filterOpen} onOpenChange={setFilterOpen} sender={latest?.from?.emailAddress?.address ?? ""} folders={moveTargets} categories={categories} />
    </div>
  );
}
