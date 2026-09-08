import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestLyzrSite } from "./lyzr-scrape";
import { ingestSlack } from "./slack";
import { ingestDrive } from "./drive";
import { ingestInternalEmail } from "./mail";
import { ingestOneDrive } from "./onedrive";

export type KnowledgeEnv = {
  ANTHROPIC_API_KEY: string;
  SLACK_BOT_TOKEN?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  MS_GRAPH_CLIENT_ID?: string;
  MS_GRAPH_TENANT_ID?: string;
  MS_GRAPH_CLIENT_SECRET?: string;
};

export type KnowledgeSource = "lyzr_blog" | "slack" | "drive" | "onedrive" | "internal_email";

// Same one-code-path pattern as lib/sync/run.ts: the manual "Refresh"
// button and the weekly Cron Trigger both call this, so there's exactly one
// place that knows how to run each source and log it to sync_runs.
// "lyzr_blog" covers both lyzr_blog and lyzr_case_study source_type rows --
// one scrape pass produces both.
export async function runKnowledgeIngestion(
  db: SupabaseClient,
  source: KnowledgeSource,
  env: KnowledgeEnv,
  opts: { runType: "manual" | "scheduled"; triggeredBy?: string | null }
): Promise<{ status: string; fetched: number; upserted: number; flaggedForReview: number }> {
  const { data: run, error: runErr } = await db
    .from("sync_runs")
    .insert({ source_system: source, run_type: opts.runType, status: "running", triggered_by: opts.triggeredBy ?? null })
    .select("id")
    .single();
  if (runErr) throw runErr;

  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  try {
    let result: { fetched: number; upserted: number; flaggedForReview: number };
    if (source === "lyzr_blog") result = await ingestLyzrSite(db, env, log);
    else if (source === "slack") result = await ingestSlack(db, env, log);
    else if (source === "drive") result = await ingestDrive(db, env, log);
    else if (source === "onedrive") result = await ingestOneDrive(db, env, log);
    else result = await ingestInternalEmail(db, env, log);

    const status = result.upserted === 0 && logs.some((l) => l.includes("not configured") || l.includes("skipping"))
      ? "partial"
      : "success";

    await db
      .from("sync_runs")
      .update({
        status,
        finished_at: new Date().toISOString(),
        records_fetched: result.fetched,
        records_upserted: result.upserted,
        records_flagged_for_review: result.flaggedForReview,
        error_message: logs.length ? logs.join("\n").slice(0, 2000) : null,
      })
      .eq("id", run.id);

    await db
      .from("source_sync_state")
      .upsert({ source_key: source, last_synced_at: new Date().toISOString(), last_run_id: run.id }, { onConflict: "source_key" });

    return { status, ...result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .from("sync_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error_message: message.slice(0, 2000) })
      .eq("id", run.id);
    throw err;
  }
}
