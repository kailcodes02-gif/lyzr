"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { errorMessage, useCategories, useFolderNames, useFolders, useInstallPresets, useRuleMutations, useRules, type InstallResult } from "@/lib/mail/hooks";
import { PRESET_NAMES } from "@/lib/mail/labels";
import { ruleSentence } from "@/lib/mail/tabs";
import { WELL_KNOWN_LABEL, type WellKnown } from "@/lib/mail/logic";
import { PRESET_LABELS, type PresetLabel } from "@/lib/mail/presets";
import { cn } from "@/lib/utils";

function presetSummary(p: PresetLabel): string {
  const c = p.conditions;
  const parts: string[] = [];
  if (c.fromAddresses?.length) parts.push(`from ${c.fromAddresses.length} addresses`);
  if (c.senderContains?.length) parts.push(`sender contains ${c.senderContains.join(", ")}`);
  if (c.subjectContains?.length) parts.push(`subject contains ${c.subjectContains.join(", ")}`);
  if (c.meetingRequests) parts.push("calendar invitations and responses");
  if (c.newsletters) parts.push("newsletters");
  return parts.join("; ");
}

// "Set up my labels": installs PRESET_LABELS (category, folder, rules,
// backfill + move) and reports per label. Safe to re-run.
export function PresetInstaller({ meAddress, compact }: { meAddress?: string; compact?: boolean }) {
  const install = useInstallPresets();
  const categories = useCategories();
  const [open, setOpen] = useState(!compact);
  const installed = new Set((categories.data ?? []).map((c) => c.displayName.toLowerCase()));
  const results = install.data as InstallResult[] | undefined;
  return (
    <section className="rounded-xl border border-border p-3 text-sm" aria-label="Preset labels">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">My labels</p>
          <p className="text-xs text-muted-foreground">Leadership, GSI, Marketing, Meeting scripts and Calendar, each with a folder so matching mail skips the inbox.</p>
        </div>
        <Button size="sm" onClick={() => install.mutate({ meAddress })} disabled={install.isPending}>
          {install.isPending ? "Setting up" : PRESET_NAMES.every((n) => installed.has(n.toLowerCase())) ? "Update my labels" : "Set up my labels"}
        </Button>
      </div>
      {compact && (
        <button type="button" className="mt-1 text-xs text-primary underline-offset-2 hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide details" : "Show what gets created"}
        </button>
      )}
      {(open || results) && (
        <ul className="mt-2 flex flex-col gap-2" aria-label="Preset label details">
          {PRESET_LABELS.map((p) => {
            const r = results?.find((x) => x.name === p.name);
            return (
              <li key={p.name} className="text-xs">
                <span className="font-medium">{p.name}</span>
                {installed.has(p.name.toLowerCase()) && <span className="ml-1 text-muted-foreground">(exists)</span>}
                <span className="text-muted-foreground">: {presetSummary(p)}</span>
                {p.note && <p className="text-muted-foreground">{p.note} Fix addresses later via Edit label.</p>}
                {r && r.error && (
                  <p className="text-destructive" aria-label={`Result for ${p.name}`}>
                    Not set up: {r.error} Run again to retry; what was already created is kept.
                  </p>
                )}
                {r && !r.error && (
                  <p className="text-success" aria-label={`Result for ${p.name}`}>
                    {r.rules} {r.rules === 1 ? "rule" : "rules"}, {r.labelled} labelled, {r.moved} moved out of the inbox{r.failed ? `, ${r.failed} failed` : ""}
                    {r.folderName && r.folderName.toLowerCase() !== p.name.toLowerCase() ? ` (folder "${r.folderName}")` : ""}.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {install.isError && <p className="mt-2 text-xs text-destructive">{errorMessage(install.error)}</p>}
    </section>
  );
}

// Every inbox rule, including ones made in Outlook, with a plain-English
// summary, an enabled switch (PATCH isEnabled) and delete.
export function FiltersDialog({ open, onOpenChange, meAddress }: { open: boolean; onOpenChange: (o: boolean) => void; meAddress?: string }) {
  const rules = useRules(open);
  const folders = useFolders();
  const mut = useRuleMutations();
  const list = [...(rules.data ?? [])].sort((a, b) => a.sequence - b.sequence);
  // Rules that move into a subfolder: the top-level list has no name for those ids.
  const known = new Set((folders.data ?? []).map((f) => f.id));
  const unknownIds = list.flatMap((r) => [r.actions?.moveToFolder, r.actions?.copyToFolder]).filter((id): id is string => !!id && !known.has(id));
  const extraNames = useFolderNames(folders.data ? unknownIds : []);
  const folderName = (id: string) => {
    const f = folders.data?.find((x) => x.id === id);
    if (f) return WELL_KNOWN_LABEL[(f.wellKnownName ?? "").toLowerCase() as WellKnown] ?? f.displayName;
    return extraNames.data?.[id];
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Filters</DialogTitle>
          <DialogDescription>Inbox rules run in Outlook when mail arrives. Rules run in order; labels and sorting create their own rules here.</DialogDescription>
        </DialogHeader>
        <PresetInstaller meAddress={meAddress} compact />
        {rules.isPending && <p className="text-sm text-muted-foreground">Loading rules</p>}
        {rules.isError && <p className="text-sm text-destructive">Rules unavailable. {errorMessage(rules.error)}</p>}
        {rules.isSuccess && list.length === 0 && <p className="text-sm text-muted-foreground">No filters yet. Create a label with conditions to add one.</p>}
        <ul className="divide-y divide-border" aria-label="Inbox rules">
          {list.map((r) => {
            const sentence = ruleSentence(r, folderName);
            return (
              <li key={r.id} className={cn("flex items-start gap-3 py-2 text-sm", !r.isEnabled && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {sentence}{r.hasError ? " (Outlook reports an error on this rule)" : ""}
                  </p>
                </div>
                <Switch checked={r.isEnabled} aria-label={`Enable ${r.displayName}`} disabled={r.isReadOnly || mut.update.isPending} onCheckedChange={(v) => mut.update.mutate({ id: r.id, isEnabled: v })} />
                <Button variant="ghost" size="icon-sm" aria-label={`Delete filter ${r.displayName}`} disabled={r.isReadOnly} onClick={() => mut.remove.mutate({ id: r.id })}>
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
