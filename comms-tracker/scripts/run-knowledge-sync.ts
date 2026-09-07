import { config } from "dotenv";
config({ path: ".env.local" });

import { createSyncDbClient } from "../lib/sync/db";
import { runKnowledgeIngestion, type KnowledgeSource } from "../lib/knowledge/run";

async function main() {
  const arg = process.argv[2];
  const valid = ["lyzr_blog", "slack", "drive", "internal_email", "all"];
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
    MS_GRAPH_CLIENT_SECRET: process.env.MS_GRAPH_CLIENT_SECRET,
  };

  const db = createSyncDbClient(env);
  const sources: KnowledgeSource[] =
    arg === "all" ? ["lyzr_blog", "slack", "drive", "internal_email"] : [arg as KnowledgeSource];

  for (const source of sources) {
    console.log(`\n=== Ingesting ${source} ===`);
    const result = await runKnowledgeIngestion(db, source, env, { runType: "manual" });
    console.log(result);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
