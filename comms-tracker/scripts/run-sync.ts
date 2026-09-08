import { config } from "dotenv";
config({ path: ".env.local" });

import { createSyncDbClient } from "../lib/sync/db";
import { runSync, type SyncSource } from "../lib/sync/run";

async function main() {
  const arg = process.argv[2];
  const valid = ["cortex", "hubspot", "instantly", "all"];
  if (!arg || !valid.includes(arg)) {
    console.error(`Usage: npx tsx scripts/run-sync.ts <${valid.join("|")}>`);
    process.exit(1);
  }

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    CORTEX_BASE_URL: process.env.CORTEX_BASE_URL!,
    CORTEX_API_KEY: process.env.CORTEX_API_KEY!,
    HUBSPOT_ACCESS_TOKEN: process.env.HUBSPOT_ACCESS_TOKEN!,
    INSTANTLY_API_KEY: process.env.INSTANTLY_API_KEY!,
    INSTANTLY_PRODUCT_UPDATE_TAG: process.env.INSTANTLY_PRODUCT_UPDATE_TAG,
  };

  const db = createSyncDbClient(env);
  const sources: SyncSource[] = arg === "all" ? ["cortex", "hubspot", "instantly"] : [arg as SyncSource];

  let failed = 0;
  for (const source of sources) {
    console.log(`\n=== Syncing ${source} ===`);
    try {
      const result = await runSync(db, source, env, { runType: "manual", log: (m) => console.log(m) });
      console.log(result);
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
