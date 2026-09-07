"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInternalPeopleOptions } from "@/lib/hooks/use-tasks";
import { useReassignProjectRole } from "@/lib/hooks/use-project-detail";
import { cn } from "@/lib/utils";

const MAX_RESULTS = 40;

// Admin-only picker for one of the configurable owner roles on ONE project.
// The people source is the same Lyzr-internal list the task checklist
// assignee picker uses (people.person_type = 'lyzr_internal', kept current by
// the Cortex/HubSpot sync), filtered client-side by name/email -- a few
// hundred rows, so no server round-trip per keystroke is needed. Writing
// goes through useReassignProjectRole, which retires the current holder and
// marks the new row is_manual_override so future syncs leave it alone.
export function ReassignRoleModal({
  open,
  onClose,
  projectId,
  roleKey,
  roleLabel,
  currentPersonId,
  currentPersonName,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  roleKey: string;
  roleLabel: string;
  currentPersonId: string | null;
  currentPersonName: string | null;
}) {
  const { data: people, isLoading } = useInternalPeopleOptions();
  const reassign = useReassignProjectRole();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Clear the search/selection each time the modal opens for a new role,
  // using the "adjust state during render" pattern instead of an effect.
  const [prevKey, setPrevKey] = useState(`${open}:${roleKey}`);
  if (`${open}:${roleKey}` !== prevKey) {
    setPrevKey(`${open}:${roleKey}`);
    setQuery("");
    setSelectedId(null);
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (people ?? []).filter((p) => p.id !== currentPersonId);
    if (!q) return list.slice(0, MAX_RESULTS);
    return list
      .filter((p) => (p.full_name ?? "").toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);
  }, [people, query, currentPersonId]);

  const selected = matches.find((p) => p.id === selectedId) ?? null;

  async function confirm() {
    if (!selected) {
      toast.error("Pick a person first");
      return;
    }
    try {
      await reassign.mutateAsync({ projectId, personId: selected.id, roleKey });
      toast.success(`${roleLabel} is now ${selected.full_name ?? selected.email}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`${currentPersonId ? "Reassign" : "Assign"} ${roleLabel}`}>
      <div className="space-y-3">
        {currentPersonName && (
          <p className="text-xs text-zinc-500">
            Currently <span className="font-medium text-zinc-700">{currentPersonName}</span>. The new holder is
            locked as a manual override, so the weekly Cortex/HubSpot sync will not change it back.
          </p>
        )}
        <Input
          autoFocus
          placeholder="Search Lyzr people by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="rounded-md border border-zinc-200 max-h-64 overflow-y-auto divide-y divide-zinc-100">
          {isLoading && <div className="p-3 text-sm text-zinc-400">Loading people…</div>}
          {!isLoading && matches.length === 0 && (
            <div className="p-3 text-sm text-zinc-400">No internal people match.</div>
          )}
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              className={cn(
                "w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-50",
                selectedId === p.id && "bg-violet-50 hover:bg-violet-50"
              )}
            >
              <span className="font-medium text-zinc-900 truncate">{p.full_name ?? p.email}</span>
              <span className="text-xs text-zinc-400 truncate">{p.email}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={confirm} disabled={!selected || reassign.isPending}>
            {reassign.isPending ? "Saving…" : "Confirm"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
