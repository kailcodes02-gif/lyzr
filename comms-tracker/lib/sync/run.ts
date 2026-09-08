import { errorMessage } from "./util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncCortex } from "./cortex-sync";
import { syncHubSpot } from "./hubspot-sync";
import { syncInstantly } from "./instantly-sync";

export type SyncEnv = {
  CORTEX_BASE_URL: string;
  CORTEX_API_KEY: string;
  HUBSPOT_ACCESS_TOKEN: string;
  INSTANTLY_API_KEY: string;
  INSTANTLY_PRODUCT_UPDATE_TAG?: string;
};

export type SyncSource = "cortex" | "hubspot" | "instantly";

// The one code path both the manual "Refresh now" Worker route and the
// future Cron Trigger call — see plan Phase 4.
export async function runSync(
  db: SupabaseClient,
  source: SyncSource,
  env: SyncEnv,
  opts: { runType: "manual" | "scheduled"; triggeredBy?: string | null; log?: (msg: string) => void }
): Promise<{ status: string; fetched: number; upserted: number; flaggedForReview: number }> {
  const log = opts.log ?? (() => {});
  const { data: run, error: runErr } = await db
    .from("sync_runs")
    .insert({
      source_system: source,
      run_type: opts.runType,
      status: "running",
      triggered_by: opts.triggeredBy ?? null,
    })
    .select("id")
    .single();
  if (runErr) throw runErr;

  try {
    let result: { fetched: number; upserted: number; flaggedForReview: number };
    if (source === "cortex") result = await syncCortex(db, env);
    else if (source === "hubspot") result = await syncHubSpot(db, env);
    else result = await syncInstantly(db, env, log);

    const status = result.flaggedForReview > 0 ? "partial" : "success";

    await db
      .from("sync_runs")
      .update({
        status,
        finished_at: new Date().toISOString(),
        records_fetched: result.fetched,
        records_upserted: result.upserted,
        records_flagged_for_review: result.flaggedForReview,
      })
      .eq("id", run.id);

    await db.from("source_sync_state").upsert(
      { source_key: source, last_synced_at: new Date().toISOString(), last_run_id: run.id },
      { onConflict: "source_key" }
    );

    return { status, ...result };
  } catch (err) {
    const message = errorMessage(err);
    await db
      .from("sync_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error_message: message.slice(0, 2000) })
      .eq("id", run.id);
    throw err;
  }
}
