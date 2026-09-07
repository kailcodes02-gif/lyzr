"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type SyncRunRow = {
  id: string;
  source_system: string;
  run_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  records_fetched: number | null;
  records_upserted: number | null;
  records_flagged_for_review: number | null;
  error_message: string | null;
};

export function useSyncState() {
  return useQuery({
    queryKey: ["sync-state"],
    queryFn: async () => {
      const supabase = createClient();
      const [{ data: state, error: stateErr }, { data: runs, error: runsErr }] = await Promise.all([
        supabase.from("source_sync_state").select("*"),
        supabase.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(20),
      ]);
      if (stateErr) throw stateErr;
      if (runsErr) throw runsErr;
      return { state: state ?? [], runs: (runs ?? []) as SyncRunRow[] };
    },
    refetchInterval: 10_000,
  });
}
