"use client";

import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { FolderNode } from "@/lib/drive/logic";
import { cn } from "@/lib/utils";

export function NameDialog({ open, title, initial, submitLabel, onClose, onSubmit }: { open: boolean; title: string; initial: string; submitLabel: string; onClose: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setName(initial);
  }
  const valid = name.trim().length > 0 && !/[\\/:*?"<>|]/.test(name);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader><DialogTitle className="text-lg">{title}</DialogTitle></DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onSubmit(name.trim());
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Name"
            aria-invalid={!valid && name.length > 0}
            onFocus={(e) => {
              const dot = initial.lastIndexOf(".");
              e.target.setSelectionRange(0, dot > 0 ? dot : initial.length);
            }}
            className="h-11 rounded-lg text-base"
          />
          {!valid && name.length > 0 && <p className="mt-1 text-xs text-destructive">Names cannot contain \ / : * ? &quot; &lt; &gt; |</p>}
          <DialogFooter className="mt-4 bg-transparent">
            <Button type="button" variant="ghost" className="rounded-full" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!valid} className="rounded-full bg-[#1a73e8] text-white hover:bg-[#1765cc]">{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDeleteDialog({ open, names, onClose, onConfirm }: { open: boolean; names: string[]; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader><DialogTitle className="text-lg">Move to OneDrive recycle bin?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          {names.length === 1 ? <><b className="text-foreground">{names[0]}</b> will be moved to the recycle bin.</> : <>{names.length} items will be moved to the recycle bin.</>} You can restore them from OneDrive on the web.
        </p>
        <DialogFooter className="bg-transparent">
          <Button variant="ghost" className="rounded-full" onClick={onClose}>Cancel</Button>
          <Button className="rounded-full bg-[#1a73e8] text-white hover:bg-[#1765cc]" onClick={onConfirm}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TreeNode({ node, depth, selected, disabled, onPick, expanded, toggle }: { node: FolderNode; depth: number; selected: string | null; disabled: Set<string>; onPick: (id: string) => void; expanded: Set<string>; toggle: (id: string) => void }) {
  const open = expanded.has(node.id);
  const off = disabled.has(node.id);
  return (
    <div>
      <div
        className={cn("flex h-8 items-center gap-1 rounded-lg pr-2 text-[13px]", selected === node.id ? "bg-[#c2e7ff] dark:bg-primary/25" : "hover:bg-muted", off && "opacity-40")}
        style={{ paddingLeft: depth * 16 + 4 }}
      >
        <button type="button" aria-label={open ? "Collapse" : "Expand"} onClick={() => toggle(node.id)} className={cn("rounded p-0.5 hover:bg-black/10", node.children.length === 0 && "invisible")}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <button type="button" disabled={off} onClick={() => onPick(node.id)} onDoubleClick={() => toggle(node.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <Folder className="h-4 w-4 shrink-0 fill-current text-[#5f6368]" />
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {open && node.children.map((c) => <TreeNode key={c.id} node={c} depth={depth + 1} selected={selected} disabled={disabled} onPick={onPick} expanded={expanded} toggle={toggle} />)}
    </div>
  );
}

export function MoveDialog({ open, mode, tree, disabled, count, onClose, onSubmit }: { open: boolean; mode: "move" | "copy"; tree: FolderNode; disabled: Set<string>; count: number; onClose: () => void; onSubmit: (folderId: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["root"]));
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSelected(null);
  }
  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader><DialogTitle className="text-lg">{mode === "move" ? "Move" : "Copy"} {count === 1 ? "1 item" : `${count} items`}</DialogTitle></DialogHeader>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-border p-1">
          <TreeNode node={tree} depth={0} selected={selected} disabled={disabled} onPick={setSelected} expanded={expanded} toggle={toggle} />
        </div>
        <DialogFooter className="bg-transparent">
          <Button variant="ghost" className="rounded-full" onClick={onClose}>Cancel</Button>
          <Button disabled={!selected} className="rounded-full bg-[#1a73e8] text-white hover:bg-[#1765cc]" onClick={() => selected && onSubmit(selected)}>{mode === "move" ? "Move here" : "Copy here"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
