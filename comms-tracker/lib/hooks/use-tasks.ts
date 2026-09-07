"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type TaskItemRow = {
  id: string;
  description: string;
  is_done: boolean;
  order_index: number;
  assignee: { id: string; full_name: string | null; email: string | null } | null;
};

export type TaskRow = {
  id: string;
  description: string | null;
  due_date: string | null;
  status: string;
  created_at: string;
  created_by: string;
  account: { id: string; canonical_name: string } | null;
  task_items: TaskItemRow[];
};

export function useTasks() {
  return useQuery({
    queryKey: ["tasks"],
    queryFn: async (): Promise<TaskRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("tasks")
        .select(
          "id, description, due_date, status, created_at, created_by, account:accounts(id, canonical_name), task_items(id, description, is_done, order_index, assignee:people(id, full_name, email))"
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((t) => ({
        ...t,
        // Supabase's TS types infer embedded singular FKs as arrays; the
        // query itself returns a single object per row.
        account: t.account as unknown as TaskRow["account"],
        task_items: ((t.task_items ?? []) as unknown as TaskItemRow[]).sort((a, b) => a.order_index - b.order_index),
      })) as TaskRow[];
    },
  });
}

export function useAccountOptions() {
  return useQuery({
    queryKey: ["account-options"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("accounts").select("id, canonical_name").order("canonical_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useInternalPeopleOptions() {
  return useQuery({
    queryKey: ["internal-people-options"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("people")
        .select("id, full_name, email")
        .eq("person_type", "lyzr_internal")
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      accountId: string;
      description: string;
      dueDate: string | null;
      items: Array<{ description: string; assigneePersonId: string | null }>;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: task, error: taskErr } = await supabase
        .from("tasks")
        .insert({
          account_id: input.accountId,
          description: input.description,
          due_date: input.dueDate,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (taskErr) throw taskErr;

      const items = input.items.filter((i) => i.description.trim().length > 0);
      if (items.length > 0) {
        const { error: itemsErr } = await supabase.from("task_items").insert(
          items.map((item, i) => ({
            task_id: task.id,
            description: item.description,
            assignee_person_id: item.assigneePersonId,
            order_index: i,
          }))
        );
        if (itemsErr) throw itemsErr;
      }
      return task.id as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const supabase = createClient();
      // RLS (creator or admin) is the real gate — a blocked delete returns
      // 0 rows, not an error, so request the deleted row back explicitly
      // and treat an empty result as "not allowed" rather than "done".
      const { data, error } = await supabase.from("tasks").delete().eq("id", taskId).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("You don't have permission to delete this task.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useToggleTaskItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { taskItemId: string; taskId: string; isDone: boolean }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase
        .from("task_items")
        .update({
          is_done: input.isDone,
          completed_at: input.isDone ? new Date().toISOString() : null,
          completed_by: input.isDone ? (user?.id ?? null) : null,
        })
        .eq("id", input.taskItemId);
      if (error) throw error;

      // Roll the parent task's status up from its items' completion state.
      const { data: items, error: itemsErr } = await supabase
        .from("task_items")
        .select("is_done")
        .eq("task_id", input.taskId);
      if (itemsErr) throw itemsErr;
      const allDone = (items ?? []).length > 0 && (items ?? []).every((i) => i.is_done);
      const anyDone = (items ?? []).some((i) => i.is_done);
      const status = allDone ? "done" : anyDone ? "in_progress" : "open";
      const { error: taskErr } = await supabase.from("tasks").update({ status }).eq("id", input.taskId);
      if (taskErr) throw taskErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
