"use client";

import { useState } from "react";
import Link from "next/link";
import { ListPlus, Circle, CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { useTasks, useToggleTaskItem, useDeleteTask, type TaskRow } from "@/lib/hooks/use-tasks";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { CreateTaskModal } from "@/components/tasks/create-task-modal";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<string, "zinc" | "blue" | "emerald" | "red"> = {
  open: "zinc",
  in_progress: "blue",
  done: "emerald",
  cancelled: "red",
};

function TaskCard({ task, canDelete }: { task: TaskRow; canDelete: boolean }) {
  const toggle = useToggleTaskItem();
  const deleteTask = useDeleteTask();
  const [confirming, setConfirming] = useState(false);
  const done = task.task_items.filter((i) => i.is_done).length;

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    try {
      await deleteTask.mutateAsync(task.id);
      toast.success("Task deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {task.account && (
              <Link href={`/accounts?id=${task.account.id}`} className="text-sm font-medium text-zinc-900 hover:underline">
                {task.account.canonical_name}
              </Link>
            )}
            <Badge color={STATUS_COLOR[task.status] ?? "zinc"}>{task.status.replace("_", " ")}</Badge>
          </div>
          <p className="text-sm text-zinc-600 mt-0.5">{task.description}</p>
          <div className="text-xs text-zinc-400 mt-1">
            {task.due_date ? `Due ${new Date(task.due_date).toLocaleDateString()}` : "No due date"} · {done}/
            {task.task_items.length} done
          </div>
        </div>
        {canDelete && (
          <button
            onClick={handleDelete}
            onBlur={() => setConfirming(false)}
            disabled={deleteTask.isPending}
            className={cn(
              "shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-md",
              confirming ? "bg-red-600 text-white" : "text-zinc-400 hover:text-red-600 hover:bg-red-50"
            )}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {confirming && "Confirm?"}
          </button>
        )}
      </div>

      <div className="mt-3 space-y-1.5">
        {task.task_items.map((item) => (
          <button
            key={item.id}
            onClick={() => toggle.mutate({ taskItemId: item.id, taskId: task.id, isDone: !item.is_done })}
            className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md hover:bg-zinc-50 group"
          >
            {item.is_done ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <Circle className="w-4 h-4 text-zinc-300 group-hover:text-zinc-400 shrink-0" />
            )}
            <span className={cn("text-sm", item.is_done ? "text-zinc-400 line-through" : "text-zinc-700")}>
              {item.description}
            </span>
            {item.assignee && (
              <span className="ml-auto text-xs text-zinc-400 shrink-0">
                {item.assignee.full_name ?? item.assignee.email}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const { data: tasks, isLoading } = useTasks();
  const { data: me } = useCurrentUser();
  const [modalOpen, setModalOpen] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("open");

  const visible = (tasks ?? []).filter((t) => (filter === "all" ? true : t.status !== "done" && t.status !== "cancelled"));

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 flex items-center gap-1.5">
            Tasks
            <InfoTip>
              A checklist per account for the &quot;send an update email&quot; workflow. Nobody sends from inside this
              app — when the email actually goes out via Instantly, come back and check off the item. Anyone can
              create a task and check off items; only the task&apos;s creator or an admin can delete it.
            </InfoTip>
          </h1>
        </div>
        <Button variant="primary" onClick={() => setModalOpen(true)} className="rounded-full">
          <ListPlus className="w-4 h-4" /> New task
        </Button>
      </div>

      <div className="mt-4 flex gap-1 border-b border-zinc-200">
        {(["open", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-2 text-sm border-b-2 -mb-px capitalize",
              filter === f ? "border-zinc-900 text-zinc-900 font-medium" : "border-transparent text-zinc-500"
            )}
          >
            {f === "open" ? "Open" : "All"}
          </button>
        ))}
      </div>

      {isLoading && <div className="mt-6 text-sm text-zinc-400">Loading…</div>}

      {visible.length === 0 && !isLoading && (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-400">
          {filter === "open" ? "No open tasks." : "No tasks yet."}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {visible.map((task) => (
          <TaskCard key={task.id} task={task} canDelete={Boolean(me) && (me!.role === "admin" || me!.id === task.created_by)} />
        ))}
      </div>

      <CreateTaskModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
