# GTM blueprint restructure — go-live runbook

The tracker's taxonomy and content are now seeded from the GSI_GTM_2 blueprint
(4 categories → 12 channels → 38 sub-channels → 94 activity tasks, with tiers,
star grades, owners, budgets, resources, and learnings).
This file is the exact sequence to bring the restructured database live.

## One-time go-live steps

1. **Reset the database** — open Supabase Dashboard → SQL Editor, paste the
   ENTIRE contents of `supabase/RESET_ALL.sql`, Run.
   - DESTRUCTIVE: wipes all tables in `public` (the June 2026 test data).
     Auth accounts survive and are re-mirrored automatically.
   - The final result grid is a sanity check; `admin present` must be `1`
     (kailash.gm@lyzr.ai). If it is `0`, sign in to the app once, then re-run
     just the backfill INSERT at the bottom of the file.

2. **Fill the owner mapping** — edit `scripts/owner-emails.json`, replacing
   each `""` with that person's real @lyzr.ai email. Names left blank seed
   unowned and are listed at the end of the seed run.
   ("Partnership Team" / "Unassigned" items intentionally seed unowned.)

3. **Seed the blueprint**:
   ```bash
   node scripts/seed-gtm.mjs
   ```
   Expected output: 4 categories, 50 channels (12 top + 38 sub), 94 tasks,
   resources, learnings, channel_fields, budget periods, then the owner pass.

4. **Verify in the app**: `npm run dev` → sign in → sidebar shows the 4 GTM
   categories with tier-badged channels; any channel page shows its kanban
   with pre-assigned activity cards, ★ grades, and the Resources & Learnings tab.

## Later: owner emails arrive/change

Re-apply owners only (safe, idempotent — never touches tasks/taxonomy):

```bash
node scripts/seed-gtm.mjs --owners-only
```

People who have never signed in are held in `pending_assignments` /
`channel_owners.user_id = NULL` and resolve automatically on their first
Google sign-in (trigger in migration 010).

## Regenerating RESET_ALL.sql

`supabase/RESET_ALL.sql` is generated — never hand-edit it. After changing any
migration: `node scripts/build-reset-sql.mjs`.
Migration 006 (old-taxonomy channel_fields seed) is intentionally excluded.

## Deployment (still to decide)

The app remains local-only. For multi-owner use it needs hosting (Vercel
recommended: free tier, native Next.js, cron support for
`/api/cron/weekly-snapshot` and `/api/cron/hubspot-sync` with `CRON_SECRET`).
The Google OAuth redirect URL and `NEXT_PUBLIC_SITE_URL` must be updated for
the deployed domain.
