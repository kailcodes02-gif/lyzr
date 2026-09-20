"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage, settleAction, useBackfill, useCategoryMutations, useFolders, useGraphApi, useMoveLabelBack, useRules } from "@/lib/mail/hooks";
import { ensureCategory, ensureFolder, replaceLabelRules, safeFolderName } from "@/lib/mail/install";
import { conditionsFromRules, EMPTY_CONDITIONS, foreignRules, labelSaveBlocked, moveFolderOf, type LabelConditions } from "@/lib/mail/labels";
import { PRESET_COLORS } from "@/lib/mail/logic";
import type { OutlookCategory } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

// Gmail-style chip input: Enter, comma or blur commits the typed value.
export function ChipInput({ value, onChange, placeholder, label }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; label: string }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const parts = draft.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange(Array.from(new Set([...value, ...parts])));
    setDraft("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border border-input px-2 py-1" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}>
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="rounded-full hover:bg-black/10">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        value={draft}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export type LabelDialogState = { mode: "create" } | { mode: "edit"; category: OutlookCategory };

// Create or edit a label: category colour + one inbox rule per condition
// group, optionally moving matches into a folder of the label's name ("skip
// the inbox"). Names cannot change after creation (Graph only PATCHes color).
export function LabelDialog({ state, onClose, meAddress }: { state: LabelDialogState | null; onClose: () => void; meAddress?: string }) {
  return state ? <LabelDialogBody key={state.mode === "edit" ? state.category.id : "new"} state={state} onClose={onClose} meAddress={meAddress} /> : null;
}

type Loaded = { cond: LabelConditions; skipInbox: boolean; folderId?: string };

function LabelDialogBody({ state, onClose, meAddress }: { state: LabelDialogState; onClose: () => void; meAddress?: string }) {
  const editing = state.mode === "edit" ? state.category : undefined;
  const rules = useRules();
  const folders = useFolders();
  const api = useGraphApi();
  const qc = useQueryClient();
  const catMut = useCategoryMutations();
  const backfill = useBackfill();
  const moveBack = useMoveLabelBack();
  const [name, setName] = useState(editing?.displayName ?? "");
  const [color, setColor] = useState(editing?.color ?? "preset7");
  const [loaded, setLoaded] = useState<Loaded | null>(editing ? null : { cond: EMPTY_CONDITIONS, skipInbox: false });
  const [apply, setApply] = useState(true);
  const [busy, setBusy] = useState(false);
  const [movedBack, setMovedBack] = useState(false);
  // Pre-fill from the label's existing rules once they load (skip-inbox = a rule that moves).
  if (editing && loaded === null && (rules.data || rules.isError)) {
    const folderId = rules.data ? moveFolderOf(editing.displayName, rules.data) : undefined;
    setLoaded({ cond: rules.data ? conditionsFromRules(editing.displayName, rules.data) : EMPTY_CONDITIONS, skipInbox: !!folderId, folderId });
  }
  const c = loaded?.cond ?? EMPTY_CONDITIONS;
  const skipInbox = loaded?.skipInbox ?? false;
  const set = (patch: Partial<LabelConditions>) => setLoaded({ ...(loaded ?? { cond: EMPTY_CONDITIONS, skipInbox: false }), cond: { ...c, ...patch } });
  const setSkip = (v: boolean) => setLoaded({ ...(loaded ?? { cond: EMPTY_CONDITIONS, skipInbox: false }), skipInbox: v });
  const hasConditions = c.from.length > 0 || c.subject.length > 0 || c.meetings || c.newsletters || c.toMe;
  const foreign = editing && rules.data ? foreignRules(editing.displayName, rules.data) : [];
  // The folder this label's mail currently sits in: from its rules, else a folder with its name.
  const currentFolderId = loaded?.folderId ?? (editing ? folders.data?.find((f) => f.displayName.toLowerCase() === editing.displayName.toLowerCase())?.id : undefined);

  const runBackfill = async (label: string, folderId?: string) => {
    const n = await backfill(label, c, meAddress, folderId);
    if (n.labelled === 0 && n.moved === 0) toast.success(`No existing mail matched "${label}"`);
    else toast.success(`${n.labelled} ${n.labelled === 1 ? "message" : "messages"} labelled "${label}"${folderId ? `, ${n.moved} moved out of the inbox` : ""}`);
  };

  // Editing without the label's rules would wipe them on save (replaceLabelRules
  // recreates from the dialog's, empty, conditions), so Save waits for them.
  const blocked = labelSaveBlocked({ name, busy, editing: !!editing, loaded: loaded !== null, rulesFailed: rules.isError });

  const save = async () => {
    const label = name.trim();
    if (!label || blocked) return;
    setBusy(true);
    try {
      if (editing) {
        if (color !== editing.color) await catMut.update.mutateAsync({ id: editing.id, color });
      } else {
        // Idempotent: a retry after a failed folder or rule step resumes
        // instead of failing on the duplicate category.
        await ensureCategory(api, label, color);
      }
      const folder = skipInbox ? await ensureFolder(api, label) : undefined;
      // Replace this label's own rules wholesale (foreign Outlook rules stay).
      await replaceLabelRules(api, label, c, folder ? { moveToFolder: folder.id } : {});
      if (!editing) {
        toast.success(`Label "${label}" created`);
        void settleAction(qc, "category", { labels: [label] });
      }
      if (folder && folder.displayName.toLowerCase() !== label.toLowerCase()) toast.info(`Outlook reserves the folder name "${label}"; matching mail is filed under "${folder.displayName}".`);
      await Promise.all([rules.refetch(), folder && !folders.data?.some((f) => f.id === folder.id) ? folders.refetch() : undefined]);
      if (apply && hasConditions) await runBackfill(label, folder?.id);
      onClose();
    } catch (e) {
      toast.error(`Could not save label. ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const moveBackNow = async () => {
    if (!editing || !currentFolderId) return;
    setBusy(true);
    try {
      const n = await moveBack(editing.displayName, currentFolderId);
      setMovedBack(true);
      toast.success(n === 0 ? `No "${editing.displayName}" mail to move` : `${n} ${n === 1 ? "message" : "messages"} moved back to the Inbox`);
    } catch (e) {
      toast.error(`Could not move mail. ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit label "${editing.displayName}"` : "New label"}</DialogTitle>
          <DialogDescription>{editing ? "Outlook labels cannot be renamed, but you can change the colour and the conditions." : "Labels are Outlook categories. Conditions become inbox rules that label new mail as it arrives."}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Name</span>
            <Input autoFocus={!editing} value={name} onChange={(e) => setName(e.target.value)} placeholder="Label name" aria-label="Label name" disabled={!!editing} />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Colour</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
              {Object.entries(PRESET_COLORS).map(([k, v]) => (
                <button key={k} type="button" role="radio" aria-label={v.name} aria-checked={color === k} title={v.name} onClick={() => setColor(k)} className={cn("h-6 w-6 rounded-full border-2", color === k ? "border-foreground" : "border-transparent")} style={{ background: v.hex }} />
              ))}
            </div>
          </div>
          <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Automatically label mail that matches</legend>
            {editing && rules.isPending && <p className="text-xs text-muted-foreground">Loading the label&apos;s rules</p>}
            {editing && rules.isError && <p className="text-xs text-destructive">Rules unavailable, conditions cannot be edited. {errorMessage(rules.error)}</p>}
            <label className="flex flex-col gap-1">
              <span className="text-xs">From</span>
              <ChipInput label="From addresses or domains" value={c.from} onChange={(from) => set({ from })} placeholder="siva@lyzr.ai, @accenture.com" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs">Subject contains</span>
              <ChipInput label="Subject contains" value={c.subject} onChange={(subject) => set({ subject })} placeholder="Weekly report, Meeting notes" />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>Calendar invitations and responses</span>
              <Switch checked={c.meetings} onCheckedChange={(v) => set({ meetings: v })} aria-label="Calendar invitations and responses" />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>Newsletters (has an unsubscribe link)</span>
              <Switch checked={c.newsletters} onCheckedChange={(v) => set({ newsletters: v })} aria-label="Newsletters" />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>Sent only to me</span>
              <Switch checked={c.toMe} onCheckedChange={(v) => set({ toMe: v })} aria-label="Sent only to me" />
            </label>
            {foreign.length > 0 && (
              <p className="text-xs text-muted-foreground" aria-label="Other rules for this label">
                Also labelled by Outlook {foreign.length === 1 ? "rule" : "rules"} {foreign.map((r) => `"${r.displayName}"`).join(", ")} (managed in Outlook, left unchanged).
              </p>
            )}
          </fieldset>
          <label className={cn("flex items-center justify-between gap-3", !hasConditions && "opacity-50")}>
            <span className="flex flex-col">
              <span>Skip the inbox (show only under this label)</span>
              <span className="text-xs text-muted-foreground">Matching mail moves into a &quot;{safeFolderName(name.trim() || "label")}&quot; folder and never appears in Primary, Social or Promotions.</span>
            </span>
            <Switch checked={skipInbox} onCheckedChange={setSkip} disabled={!hasConditions && !skipInbox} aria-label="Skip the inbox" />
          </label>
          <label className={cn("flex items-center gap-2", !hasConditions && "opacity-50")}>
            <Checkbox checked={apply} onCheckedChange={(v) => setApply(!!v)} disabled={!hasConditions} aria-label="Also label matching mail already in my inbox" />
            {skipInbox ? "Also label and move matching mail already in my inbox" : "Also label matching mail already in my inbox"}
          </label>
        </form>
        <DialogFooter className="sm:justify-between">
          {editing ? (
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" size="sm" disabled={!hasConditions || busy} onClick={() => void runBackfill(editing.displayName, skipInbox ? currentFolderId : undefined).catch((e) => toast.error(errorMessage(e)))}>
                Run on existing mail now
              </Button>
              {currentFolderId && !movedBack && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void moveBackNow()}>
                  Move this label&apos;s mail back to Inbox
                </Button>
              )}
            </div>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void save()} disabled={blocked}>
              {busy ? "Saving" : editing ? "Save" : "Create"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
