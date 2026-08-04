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

## Deployment (static architecture, $0 — current as of Aug 3 2026)

The tracker is a pure static export served by the existing Cloudflare Pages
site at https://lyzr.kailash-gm.com/GSI_Tracker/. There is NO server: the
browser talks to Supabase directly and RLS enforces permissions.

To ship a change:
```bash
cd "GSI Tracker/tracker"
NEXT_PUBLIC_SITE_URL=https://lyzr.kailash-gm.com/GSI_Tracker npm run build
cp -R out/. ../../GSI_Tracker/   # MERGE, do not delete: old builds' chunks
                                 # must survive so open tabs don't break
cd ../.. && git add GSI_Tracker "GSI Tracker" && git commit -m "deploy tracker" && git push
```
Pages redeploys automatically in ~2 minutes (occasionally slower when queued).
Housekeeping: every ~20 deploys the accumulated old chunks can be pruned by
doing one destructive deploy (`rm -rf ../../GSI_Tracker` before the copy) at a
quiet time — that single deploy will break tabs that are already open.

Notes:
- Local dev: http://localhost:3000/GSI_Tracker (npm run dev). The old
  /api/dev-login bypass is gone — sign in with Google (localhost callback must
  be in Supabase's redirect allowlist).
- Supabase Auth → URL Configuration must contain:
  Site URL  https://lyzr.kailash-gm.com/GSI_Tracker
  Redirects https://lyzr.kailash-gm.com/GSI_Tracker/auth/callback/
            http://localhost:3000/GSI_Tracker/auth/callback/
- Do not recreate the Cloudflare Worker; it was removed intentionally.
