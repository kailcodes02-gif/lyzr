"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccountOptions, useCreateTask, useInternalPeopleOptions } from "@/lib/hooks/use-tasks";

type ChecklistItem = { description: string; assigneePersonId: string | null };

const DEFAULT_ITEMS: ChecklistItem[] = [
  { description: "Draft update content", assigneePersonId: null },
  { description: "Send via Instantly", assigneePersonId: null },
];

export function CreateTaskModal({
  open,
  onClose,
  defaultAccountId,
}: {
  open: boolean;
  onClose: () => void;
  defaultAccountId?: string;
}) {
  const { data: accounts } = useAccountOptions();
  const { data: people } = useInternalPeopleOptions();
  const createTask = useCreateTask();

  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const [description, setDescription] = useState("Send product update email");
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<ChecklistItem[]>(DEFAULT_ITEMS);

  // Reset the account picker each time the modal (re)opens -- done as the
  // React-documented "adjust state during render" pattern rather than an
  // effect, so it doesn't schedule a second render pass.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setAccountId(defaultAccountId ?? "");
  }

  const updateItem = (i: number, patch: Partial<ChecklistItem>) =>
    setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));

  const submit = async () => {
    if (!accountId) {
      toast.error("Pick an account");
      return;
    }
    try {
      await createTask.mutateAsync({
        accountId,
        description,
        dueDate: dueDate || null,
        items,
      });
      toast.success("Task created");
      setDescription("Send product update email");
      setDueDate("");
      setItems(DEFAULT_ITEMS);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Send update email — new task" wide>
      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-zinc-600">Account</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Select an account…</option>
            {(accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.canonical_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-600">Description</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" />
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-600">Due date</label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1" />
        </div>

        <div>
          <label className="text-xs font-medium text-zinc-600">Checklist</label>
          <div className="mt-1 space-y-2">
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={item.description}
                  onChange={(e) => updateItem(i, { description: e.target.value })}
                  placeholder="e.g. Review content"
                  className="flex-1"
                />
                <select
                  value={item.assigneePersonId ?? ""}
                  onChange={(e) => updateItem(i, { assigneePersonId: e.target.value || null })}
                  className="w-44 shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-2 text-xs"
                >
                  <option value="">Unassigned</option>
                  {(people ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name ?? p.email}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-zinc-400 hover:text-red-600 shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setItems((prev) => [...prev, { description: "", assigneePersonId: null }])}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900"
            >
              <Plus className="w-3.5 h-3.5" /> Add checklist item
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={createTask.isPending}>
            {createTask.isPending ? "Creating…" : "Create task"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
