"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type CurrentUser = { id: string; email: string; role: "admin" | "member" };

export function useCurrentUser() {
  return useQuery({
    queryKey: ["current-user"],
    queryFn: async (): Promise<CurrentUser | null> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase.from("users").select("id, email, role").eq("id", user.id).single();
      if (error) throw error;
      return data as CurrentUser;
    },
    staleTime: 60_000,
  });
}
