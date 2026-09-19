"use client";

import { Archive, ChevronDown, ChevronRight, File, FolderPlus, Inbox, MoreVertical, Pencil, Plus, Send, ShieldAlert, Star, Tag, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useCategories, useCategoryMutations, useChildFolders, useFolderMutations, useFolders } from "@/lib/mail/hooks";
import { orderFolders, presetHex, PRESET_COLORS, STARRED_ID, visibleFolders, WELL_KNOWN_LABEL, type WellKnown } from "@/lib/mail/logic";
import type { MailFolder } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

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
      <div
        className={cn("group flex h-8 cursor-pointer items-center gap-2 rounded-r-full pr-2 text-sm hover:bg-black/5 dark:hover:bg-white/10", isActive && "bg-accent font-semibold")}
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() => onSelect(key)}
        role="link"
        aria-current={isActive ? "page" : undefined}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? "Collapse" : "Expand"}
            className="-ml-1 rounded p-0.5 text-muted-foreground hover:bg-black/10"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-3.5" />
        )}
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{label}</span>
        {!!badge && badge > 0 && <span className={cn("text-xs", isActive ? "font-semibold" : "text-muted-foreground")}>{badge}</span>}
        {custom && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<button aria-label={`Options for ${folder.displayName}`} className="rounded p-0.5 opacity-0 hover:bg-black/10 group-hover:opacity-100 data-popup-open:opacity-100" onClick={(e) => e.stopPropagation()} />}
            >
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

export function FolderPanel({ active, onSelect, onCompose, className }: { active: string; onSelect: (key: string) => void; onCompose: () => void; className?: string }) {
  const folders = useFolders();
  const categories = useCategories();
  const folderMut = useFolderMutations();
  const catMut = useCategoryMutations();
  const [dialog, setDialog] = useState<null | { kind: "new"; parent?: MailFolder } | { kind: "rename"; folder: MailFolder } | { kind: "delete"; folder: MailFolder } | { kind: "label" }>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("preset7");
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
    if (dialog.kind === "label" && name.trim()) catMut.create.mutate({ displayName: name.trim(), color });
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
        {folders.isPending && (
          <div className="space-y-2 px-3 py-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-6 animate-pulse rounded bg-muted" />
            ))}
          </div>
        )}
        {folders.isError && <p className="px-4 py-2 text-xs text-destructive">Folders unavailable</p>}
        {withStarred.map((f) =>
          f === "starred" ? (
            <div
              key="starred"
              role="link"
              aria-current={active === STARRED_ID ? "page" : undefined}
              onClick={() => onSelect(STARRED_ID)}
              className={cn("flex h-8 cursor-pointer items-center gap-2 rounded-r-full pl-3 pr-2 text-sm hover:bg-black/5 dark:hover:bg-white/10", active === STARRED_ID && "bg-accent font-semibold")}
            >
              <span className="w-3.5" />
              <Star className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">Starred</span>
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
          <button type="button" aria-label="New label" onClick={() => { setName(""); setDialog({ kind: "label" }); }} className="rounded p-1 text-muted-foreground hover:bg-black/10 hover:text-foreground">
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {labelsOpen && (
          <div className="mt-1">
            {categories.isPending && <div className="mx-4 h-5 animate-pulse rounded bg-muted" />}
            {categories.isError && <p className="px-4 py-1 text-xs text-muted-foreground">Labels need the mailbox settings permission.</p>}
            {categories.data?.length === 0 && <p className="px-4 py-1 text-xs text-muted-foreground">No labels yet</p>}
            {categories.data?.map((c) => (
              <div key={c.id} className="group flex h-7 items-center gap-2 pl-[30px] pr-2 text-sm hover:bg-black/5 dark:hover:bg-white/10">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: presetHex(c.color) }} aria-hidden />
                <span className="flex-1 truncate">{c.displayName}</span>
                <button type="button" aria-label={`Delete label ${c.displayName}`} onClick={() => catMut.remove.mutate({ id: c.id })} className="rounded p-0.5 opacity-0 hover:bg-black/10 group-hover:opacity-100">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
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
              {dialog?.kind === "label" && "New label"}
            </DialogTitle>
          </DialogHeader>
          {dialog?.kind === "delete" ? (
            <p className="text-sm text-muted-foreground">
              &quot;{dialog.folder.displayName}&quot; and its messages move to Trash.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="flex flex-col gap-3"
            >
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={dialog?.kind === "label" ? "Label name" : "Folder name"} aria-label="Name" />
              {dialog?.kind === "label" && (
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
                  {Object.entries(PRESET_COLORS).map(([k, v]) => (
                    <button key={k} type="button" role="radio" aria-checked={color === k} title={v.name} onClick={() => setColor(k)} className={cn("h-6 w-6 rounded-full border-2", color === k ? "border-foreground" : "border-transparent")} style={{ background: v.hex }} />
                  ))}
                </div>
              )}
            </form>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant={dialog?.kind === "delete" ? "destructive" : "default"} onClick={submit} disabled={dialog?.kind !== "delete" && !name.trim()}>
              {dialog?.kind === "delete" ? "Delete" : dialog?.kind === "rename" ? "Rename" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
