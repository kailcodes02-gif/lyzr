"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type RoleRow = {
  key: string;
  label: string;
  is_active: boolean;
  sort_order: number;
};

export function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn: async (): Promise<RoleRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.from("roles").select("key, label, is_active, sort_order").order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpdateRoleLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; label: string }) => {
      const supabase = createClient();
      // RLS enforces admin-only writes -- a non-admin's request is a silent
      // no-op row match, not an error, same caveat as useSetUserRole.
      const { error } = await supabase.from("roles").update({ label: input.label }).eq("key", input.key);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });
}

export function useToggleRoleActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.from("roles").update({ is_active: input.isActive }).eq("key", input.key);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; label: string; sortOrder: number }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("roles")
        .insert({ key: input.key, label: input.label, sort_order: input.sortOrder });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });
}
