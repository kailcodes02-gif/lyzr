"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { useAccountOptions, useCreateTask, useInternalPeopleOptions } from "@/lib/hooks/use-tasks";

type ChecklistItem = { description: string; assigneePersonId: string | null };

// Instantly is never a send channel -- the send step is the project page's
// Generate & Send, which opens the user's own Gmail/Outlook compose window.
const DEFAULT_ITEMS: ChecklistItem[] = [
  { description: "Draft update content (Generate & Send on the project)", assigneePersonId: null },
  { description: "Send from Gmail/Outlook and confirm", assigneePersonId: null },
];

export function CreateTaskModal({ open, onClose, defaultAccountId }: { open: boolean; onClose: () => void; defaultAccountId?: string }) {
  const { data: accounts } = useAccountOptions();
  const { data: people } = useInternalPeopleOptions();
  const createTask = useCreateTask();

  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const [description, setDescription] = useState("Send product update email");
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<ChecklistItem[]>(DEFAULT_ITEMS);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setAccountId(defaultAccountId ?? "");
  }

  const updateItem = (i: number, patch: Partial<ChecklistItem>) => setItems((prev) => prev.map((item, idx) => (idx === i ? { ...item, ...patch } : item)));

  const submit = async () => {
    if (!accountId) {
      toast.error("Pick an account");
      return;
    }
    try {
      await createTask.mutateAsync({ accountId, description, dueDate: dueDate || null, items });
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
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      description="A checklist for getting the next update email out to this account."
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={createTask.isPending}>{createTask.isPending ? "Creating…" : "Create task"}</Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="task-account">Account</Label>
          <NativeSelect id="task-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Select an account…</option>
            {(accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.canonical_name}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <div className="grid gap-2">
            <Label htmlFor="task-desc">Description</Label>
            <Input id="task-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="task-due">Due date</Label>
            <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Checklist</Label>
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={item.description} onChange={(e) => updateItem(i, { description: e.target.value })} placeholder="e.g. Review content" className="flex-1" />
                <NativeSelect value={item.assigneePersonId ?? ""} onChange={(e) => updateItem(i, { assigneePersonId: e.target.value || null })} className="w-44 shrink-0 text-xs">
                  <option value="">Unassigned</option>
                  {(people ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
                  ))}
                </NativeSelect>
                <Button variant="ghost" size="icon-sm" onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove item">
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setItems((prev) => [...prev, { description: "", assigneePersonId: null }])}>
              <Plus /> Add checklist item
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
