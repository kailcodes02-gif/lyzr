import { config } from "dotenv";
config({ path: ".env.local" });

import { createSyncDbClient } from "../lib/sync/db";
import { runKnowledgeIngestion, type KnowledgeSource } from "../lib/knowledge/run";

async function main() {
  const arg = process.argv[2];
  const valid = ["lyzr_blog", "slack", "drive", "onedrive", "internal_email", "all"];
  if (!arg || !valid.includes(arg)) {
    console.error(`Usage: npx tsx scripts/run-knowledge-sync.ts <${valid.join("|")}>`);
    process.exit(1);
  }

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    MS_GRAPH_CLIENT_ID: process.env.MS_GRAPH_CLIENT_ID,
    MS_GRAPH_TENANT_ID: process.env.MS_GRAPH_TENANT_ID,
    MS_GRAPH_CLIENT_SECRET: process.env.MS_GRAPH_CLIENT_SECRET,
  };

  const db = createSyncDbClient(env);
  const sources: KnowledgeSource[] =
    arg === "all" ? ["lyzr_blog", "slack", "drive", "onedrive", "internal_email"] : [arg as KnowledgeSource];

  // One source failing (Slack rate limit, expired Drive grant, ...) must not
  // stop the rest -- each is logged to sync_runs by runKnowledgeIngestion;
  // the process exits non-zero at the end so CI still shows the failure.
  let failed = 0;
  for (const source of sources) {
    console.log(`\n=== Ingesting ${source} ===`);
    try {
      console.log(await runKnowledgeIngestion(db, source, env, { runType: "manual" }));
    } catch (err) {
      failed++;
      console.error(`${source} failed:`, err instanceof Error ? err.message : err);
    }
  }
  if (failed > 0) {
    console.error(`\n${failed} source(s) failed`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
