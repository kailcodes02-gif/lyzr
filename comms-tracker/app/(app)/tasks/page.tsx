"use client";

import { useState } from "react";
import Link from "next/link";
import { ListPlus, Circle, CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, LoadingRows, PageHeader } from "@/components/ui/page";
import { useTasks, useToggleTaskItem, useDeleteTask, type TaskRow } from "@/lib/hooks/use-tasks";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { CreateTaskModal } from "@/components/tasks/create-task-modal";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<string, "zinc" | "blue" | "emerald" | "red"> = { open: "zinc", in_progress: "blue", done: "emerald", cancelled: "red" };

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
    <div className="bg-card rounded-xl border p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {task.account && (
              <Link href={`/accounts?id=${task.account.id}`} className="text-sm font-semibold hover:underline">
                {task.account.canonical_name}
              </Link>
            )}
            <Badge color={STATUS_COLOR[task.status] ?? "zinc"}>{task.status.replace("_", " ")}</Badge>
          </div>
          <p className="mt-0.5 text-sm">{task.description}</p>
          <div className="text-muted-foreground mt-1 text-xs">
            {task.due_date ? `Due ${new Date(task.due_date).toLocaleDateString()}` : "No due date"} · {done}/{task.task_items.length} done
          </div>
        </div>
        {canDelete && (
          <Button
            variant={confirming ? "destructive" : "ghost"}
            size="sm"
            onClick={handleDelete}
            onBlur={() => setConfirming(false)}
            disabled={deleteTask.isPending}
            aria-label="Delete task"
          >
            <Trash2 /> {confirming ? "Confirm delete" : "Delete"}
          </Button>
        )}
      </div>

      <div className="mt-3 space-y-1">
        {task.task_items.map((item) => (
          <button
            key={item.id}
            onClick={() => toggle.mutate({ taskItemId: item.id, taskId: task.id, isDone: !item.is_done })}
            className="hover:bg-muted/60 group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left cursor-pointer"
          >
            {item.is_done ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : <Circle className="text-muted-foreground/60 group-hover:text-muted-foreground size-4 shrink-0" />}
            <span className={cn("text-sm", item.is_done ? "text-muted-foreground line-through" : "")}>{item.description}</span>
            {item.assignee && <span className="text-muted-foreground ml-auto shrink-0 text-xs">{item.assignee.full_name ?? item.assignee.email}</span>}
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
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        tip="A checklist per account for the send-an-update workflow. Sending happens from a project's Generate & Send (your own Gmail or Outlook); come back here to tick items off. Anyone can create tasks; only the creator or an admin can delete one."
        description="Track who is drafting, reviewing, and sending the next update for each account."
        actions={
          <Button onClick={() => setModalOpen(true)}>
            <ListPlus /> New task
          </Button>
        }
      />

      <TabsList>
        <TabsTrigger active={filter === "open"} onClick={() => setFilter("open")}>Open</TabsTrigger>
        <TabsTrigger active={filter === "all"} onClick={() => setFilter("all")}>All</TabsTrigger>
      </TabsList>

      {isLoading && <LoadingRows />}
      {!isLoading && visible.length === 0 && (
        <EmptyState title={filter === "open" ? "No open tasks" : "No tasks yet"} description="Create one from here or from any account row in the Tracker." action={<Button variant="outline" onClick={() => setModalOpen(true)}><ListPlus /> New task</Button>} />
      )}

      <div className="max-w-3xl space-y-3">
        {visible.map((task) => (
          <TaskCard key={task.id} task={task} canDelete={Boolean(me) && (me!.role === "admin" || me!.id === task.created_by)} />
        ))}
      </div>

      <CreateTaskModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
