import { config } from "dotenv";
config({ path: ".env.local" });

import { createSyncDbClient } from "../lib/sync/db";
import { runMailboxSync, type MailProvider } from "../lib/mail/run";

// Local runner for the Gmail/Outlook mailbox reads, mirroring run-sync.ts /
// run-knowledge-sync.ts: `npx tsx scripts/run-mail-sync.ts gmail|outlook|all`.
// Needs at least one user to have clicked "Connect Google" / "Connect
// Outlook" on /admin/sync first (that's the only way a refresh token gets
// into user_oauth_tokens).
async function main() {
  const arg = (process.argv[2] ?? "all") as MailProvider | "all";
  const providers: MailProvider[] = arg === "all" ? ["gmail", "outlook"] : [arg];
  const env = process.env as Record<string, string>;
  const db = createSyncDbClient({
    NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  for (const p of providers) {
    console.log(`\n=== Mailbox sync: ${p} ===`);
    const result = await runMailboxSync(db, p, env, { runType: "manual" });
    console.log(result);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
