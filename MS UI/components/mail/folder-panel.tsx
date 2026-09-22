"use client";

import { Archive, ChevronDown, ChevronRight, Eraser, File, FolderPlus, Inbox, ListFilter, MoreVertical, Pencil, Plus, Send, ShieldAlert, Sparkles, Star, Tag, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { errorMessage, isConsentError, useCategories, useCategoryMutations, useChildFolders, useFolderMutations, useFolders, useInstallPresets, useRemoveLabelFromAll } from "@/lib/mail/hooks";
import { PRESET_NAMES } from "@/lib/mail/labels";
import { orderFolders, presetHex, STARRED_ID, visibleFolders, WELL_KNOWN_LABEL, type WellKnown } from "@/lib/mail/logic";
import type { MailFolder, OutlookCategory } from "@/lib/mail/types";
import { labelFolderKey, serializeMailUrl } from "@/lib/mail/url";
import { cn } from "@/lib/utils";
import { FiltersDialog } from "./filters-dialog";
import { LabelDialog, type LabelDialogState } from "./label-dialog";

// Folder, Starred and label rows are real links: focusable, Enter-activatable,
// Cmd/Ctrl-click opens a tab; a plain click stays a client-side navigation.
// Nested controls (chevron, options) sit beside the link, not inside it.
function FolderLink({ folderKey, active, select, className, children, ...rest }: { folderKey: string; active: boolean; select: (key: string) => void; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick" | "onSelect">) {
  return (
    <a
      href={serializeMailUrl({ folder: folderKey }) || "?"}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        select(folderKey);
      }}
      className={cn("flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-r-full outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      {...rest}
    >
      {children}
    </a>
  );
}

const ROW = "group flex h-8 items-center gap-2 rounded-r-full pr-2 text-sm hover:bg-black/5 has-[a:focus-visible]:bg-black/5 dark:hover:bg-white/10";
const HIDDEN_CONTROL = "rounded p-0.5 opacity-0 hover:bg-black/10 focus-visible:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  inbox: Inbox,
  starred: Star,
  sentitems: Send,
  drafts: File,
  archive: Archive,
  junkemail: ShieldAlert,
  deleteditems: Trash2,
};

function folderKey(f: MailFolder): string {
  return f.wellKnownName ? f.wellKnownName.toLowerCase() : f.id;
}

function FolderRow({ folder, depth, active, onSelect, onRename, onDelete, onNewChild }: { folder: MailFolder; depth: number; active: string; onSelect: (key: string) => void; onRename: (f: MailFolder) => void; onDelete: (f: MailFolder) => void; onNewChild: (f: MailFolder) => void }) {
  const [open, setOpen] = useState(false);
  const key = folderKey(folder);
  const wk = (folder.wellKnownName ?? "").toLowerCase() as WellKnown;
  const Icon = ICONS[wk] ?? Tag;
  const label = WELL_KNOWN_LABEL[wk] ?? folder.displayName;
  const hasChildren = (folder.childFolderCount ?? 0) > 0;
  const children = useChildFolders(open && hasChildren ? folder.id : null);
  const badge = wk === "drafts" ? folder.totalItemCount : folder.unreadItemCount;
  const isActive = active === key || active === folder.id;
  const custom = !folder.wellKnownName;
  return (
    <div>
      <div className={cn(ROW, isActive && "bg-accent font-semibold")} style={{ paddingLeft: 12 + depth * 14 }}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? `Collapse ${folder.displayName}` : `Expand ${folder.displayName}`}
            aria-expanded={open}
            className="-ml-1 rounded p-0.5 text-muted-foreground hover:bg-black/10"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-3.5" />
        )}
        <FolderLink folderKey={key} active={isActive} select={onSelect}>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">{label}</span>
          {!!badge && badge > 0 && <span className={cn("text-xs", isActive ? "font-semibold" : "text-muted-foreground")}>{badge}</span>}
        </FolderLink>
        {custom && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<button aria-label={`Options for ${folder.displayName}`} className={HIDDEN_CONTROL} />}>
              <MoreVertical className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onNewChild(folder)}>
                <FolderPlus /> New subfolder
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRename(folder)}>
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(folder)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {open && hasChildren && (
        <div>
          {children.isPending && <div className="py-1 text-xs text-muted-foreground" style={{ paddingLeft: 40 + depth * 14 }}>Loading</div>}
          {orderFolders(visibleFolders(children.data ?? [])).map((c) => (
            <FolderRow key={c.id} folder={c} depth={depth + 1} active={active} onSelect={onSelect} onRename={onRename} onDelete={onDelete} onNewChild={onNewChild} />
          ))}
        </div>
      )}
    </div>
  );
}

const PRESET_BANNER_KEY = "msui.mail.presetBanner";
const bannerDismissed = () => {
  try {
    return localStorage.getItem(PRESET_BANNER_KEY) === "1";
  } catch {
    return false;
  }
};

export function FolderPanel({ active, onSelect, onCompose, className, meAddress }: { active: string; onSelect: (key: string) => void; onCompose: () => void; className?: string; meAddress?: string }) {
  const folders = useFolders();
  const categories = useCategories();
  const installPresets = useInstallPresets();
  const [presetBannerHidden, setPresetBannerHidden] = useState(bannerDismissed);
  const dismissPresetBanner = () => {
    setPresetBannerHidden(true);
    try {
      localStorage.setItem(PRESET_BANNER_KEY, "1");
    } catch {
      // storage blocked
    }
  };
  // One-time offer, shown only while none of the preset label names exist.
  const showPresetBanner = !presetBannerHidden && !!categories.data && !PRESET_NAMES.some((n) => categories.data.some((c) => c.displayName.toLowerCase() === n.toLowerCase()));
  const folderMut = useFolderMutations();
  const catMut = useCategoryMutations();
  const removeFromAll = useRemoveLabelFromAll();
  const [dialog, setDialog] = useState<null | { kind: "new"; parent?: MailFolder } | { kind: "rename"; folder: MailFolder } | { kind: "delete"; folder: MailFolder } | { kind: "deleteLabel"; category: OutlookCategory }>(null);
  const [labelDialog, setLabelDialog] = useState<LabelDialogState | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [name, setName] = useState("");
  const [labelsOpen, setLabelsOpen] = useState(true);

  const list = orderFolders(visibleFolders(folders.data ?? []));
  // Starred is a virtual folder placed after Inbox.
  const withStarred: (MailFolder | "starred")[] = [];
  for (const f of list) {
    withStarred.push(f);
    if ((f.wellKnownName ?? "").toLowerCase() === "inbox") withStarred.push("starred");
  }
  if (!list.some((f) => (f.wellKnownName ?? "").toLowerCase() === "inbox") && folders.data) withStarred.unshift("starred");

  const submit = () => {
    if (!dialog) return;
    if (dialog.kind === "new" && name.trim()) folderMut.create.mutate({ displayName: name.trim(), parentId: dialog.parent?.id });
    if (dialog.kind === "rename" && name.trim()) folderMut.rename.mutate({ id: dialog.folder.id, displayName: name.trim() });
    if (dialog.kind === "delete") {
      folderMut.remove.mutate({ id: dialog.folder.id });
      if (active === dialog.folder.id) onSelect("inbox");
    }
    if (dialog.kind === "deleteLabel") {
      catMut.remove.mutate({ id: dialog.category.id, displayName: dialog.category.displayName });
      if (active === labelFolderKey(dialog.category.displayName)) onSelect("inbox");
    }
    setDialog(null);
    setName("");
  };

  return (
    <aside className={cn("flex h-full w-60 shrink-0 flex-col overflow-hidden bg-background", className)}>
      <div className="px-3 pb-2 pt-3">
        <Button onClick={onCompose} className="h-12 w-full justify-start gap-3 rounded-2xl bg-accent px-5 text-sm font-medium text-foreground shadow-sm hover:bg-accent/80 hover:shadow-md" variant="secondary">
          <Pencil className="h-4 w-4" /> Compose
        </Button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto pb-4 pr-2" aria-label="Folders">
        {folders.isPending && !folders.isError && (
          <div className="space-y-2 px-3 py-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-6 animate-pulse rounded bg-muted" />
            ))}
          </div>
        )}
        {folders.isError && !folders.data && (
          <div className="px-4 py-2 text-xs" role="alert">
            <p className="text-destructive">Folders unavailable. {errorMessage(folders.error)}</p>
            <Button variant="outline" size="sm" className="mt-1 h-6" onClick={() => void folders.refetch()} disabled={folders.isFetching}>
              {folders.isFetching ? "Retrying" : "Retry"}
            </Button>
          </div>
        )}
        {withStarred.map((f) =>
          f === "starred" ? (
            <div key="starred" className={cn(ROW, "pl-3", active === STARRED_ID && "bg-accent font-semibold")}>
              <span className="w-3.5" />
              <FolderLink folderKey={STARRED_ID} active={active === STARRED_ID} select={onSelect}>
                <Star className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">Starred</span>
              </FolderLink>
            </div>
          ) : (
            <FolderRow key={f.id} folder={f} depth={0} active={active} onSelect={onSelect} onRename={(folder) => { setName(folder.displayName); setDialog({ kind: "rename", folder }); }} onDelete={(folder) => setDialog({ kind: "delete", folder })} onNewChild={(parent) => { setName(""); setDialog({ kind: "new", parent }); }} />
          )
        )}
        {folders.data && (
          <button type="button" onClick={() => { setName(""); setDialog({ kind: "new" }); }} className="mt-1 flex h-8 w-full items-center gap-2 pl-[30px] text-sm text-muted-foreground hover:text-foreground">
            <Plus className="h-4 w-4" /> New folder
          </button>
        )}

        <div className="mt-4 flex items-center justify-between pl-4 pr-2">
          <button type="button" onClick={() => setLabelsOpen((o) => !o)} className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Labels {labelsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
          <button type="button" aria-label="New label" onClick={() => setLabelDialog({ mode: "create" })} className="rounded p-1 text-muted-foreground hover:bg-black/10 hover:text-foreground">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {labelsOpen && (
          <div className="mt-1">
            {categories.isPending && !categories.isError && <div className="mx-4 h-5 animate-pulse rounded bg-muted" />}
            {categories.isError && !categories.data && (
              <p className="px-4 py-1 text-xs text-muted-foreground" role="alert">
                {isConsentError(categories.error) ? "Labels need the mailbox settings permission." : `Labels unavailable. ${errorMessage(categories.error)}`}{" "}
                <button type="button" className="underline underline-offset-2" onClick={() => void categories.refetch()} disabled={categories.isFetching}>Retry</button>
              </p>
            )}
            {categories.data?.length === 0 && <p className="px-4 py-1 text-xs text-muted-foreground">No labels yet</p>}
            {showPresetBanner && (
              <div className="mx-3 my-1 rounded-xl bg-muted/60 p-2 text-xs" role="status">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="flex-1">Set up Leadership, GSI, Marketing, Meeting scripts and Calendar labels, each skipping the inbox.</span>
                  <button type="button" aria-label="Dismiss" onClick={dismissPresetBanner} className="rounded-full p-0.5 hover:bg-black/10">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Button size="sm" className="mt-2 h-7 w-full" onClick={() => installPresets.mutate({ meAddress })} disabled={installPresets.isPending}>
                  {installPresets.isPending ? "Setting up" : "Set up my labels"}
                </Button>
              </div>
            )}
            {categories.data?.map((c) => {
              const key = labelFolderKey(c.displayName);
              const isActive = active === key;
              return (
                <div key={c.id} className={cn(ROW, "h-7 pl-[30px]", isActive && "bg-accent font-semibold")}>
                  <FolderLink folderKey={key} active={isActive} select={onSelect} aria-label={`Label ${c.displayName}`}>
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: presetHex(c.color) }} aria-hidden />
                    <span className="flex-1 truncate">{c.displayName}</span>
                  </FolderLink>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<button aria-label={`Options for label ${c.displayName}`} className={HIDDEN_CONTROL} />}>
                      <MoreVertical className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setLabelDialog({ mode: "edit", category: c })}>
                        <Pencil /> Edit label
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          if (!window.confirm(`Remove "${c.displayName}" from every message that carries it? The label itself stays.`)) return;
                          removeFromAll(c.displayName).then((n) => toast.success(`Removed "${c.displayName}" from ${n} messages`)).catch((e) => toast.error(errorMessage(e)));
                        }}
                      >
                        <Eraser /> Remove label from all mail
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: "deleteLabel", category: c })}>
                        <Trash2 /> Delete label
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
            {categories.isSuccess && (
              <button type="button" onClick={() => setFiltersOpen(true)} className="mt-1 flex h-7 w-full items-center gap-2 pl-[30px] text-sm text-muted-foreground hover:text-foreground">
                <ListFilter className="h-4 w-4" /> Filters
              </button>
            )}
          </div>
        )}
      </nav>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === "new" && (dialog.parent ? `New folder in ${dialog.parent.displayName}` : "New folder")}
              {dialog?.kind === "rename" && "Rename folder"}
              {dialog?.kind === "delete" && "Delete folder"}
              {dialog?.kind === "deleteLabel" && "Delete label"}
            </DialogTitle>
          </DialogHeader>
          {dialog?.kind === "delete" ? (
            <p className="text-sm text-muted-foreground">
              &quot;{dialog.folder.displayName}&quot; and its messages move to Trash.
            </p>
          ) : dialog?.kind === "deleteLabel" ? (
            <p className="text-sm text-muted-foreground">
              &quot;{dialog.category.displayName}&quot; and its automatic filters are deleted. Messages keep the tag text until Outlook cleans it up, but it no longer shows as a label.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="flex flex-col gap-3"
            >
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Folder name" aria-label="Name" />
            </form>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant={dialog?.kind === "delete" || dialog?.kind === "deleteLabel" ? "destructive" : "default"} onClick={submit} disabled={dialog?.kind !== "delete" && dialog?.kind !== "deleteLabel" && !name.trim()}>
              {dialog?.kind === "delete" || dialog?.kind === "deleteLabel" ? "Delete" : dialog?.kind === "rename" ? "Rename" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <LabelDialog state={labelDialog} onClose={() => setLabelDialog(null)} meAddress={meAddress} />
      <FiltersDialog open={filtersOpen} onOpenChange={setFiltersOpen} meAddress={meAddress} />
    </aside>
  );
}
