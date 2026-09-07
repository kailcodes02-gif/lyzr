"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: "admin" | "member";
  created_at: string;
};

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async (): Promise<UserRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("users")
        .select("id, email, display_name, role, created_at")
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSetUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; role: "admin" | "member" }) => {
      const supabase = createClient();
      // RLS enforces that only an admin can actually perform this update —
      // a non-admin's request is silently a no-op row match, not an error,
      // so the mutation succeeding doesn't by itself prove the change took.
      const { error } = await supabase.from("users").update({ role: input.role }).eq("id", input.userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["current-user"] });
    },
  });
}
