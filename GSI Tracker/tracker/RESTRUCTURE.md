# Runbooks: verticals cutover (Sep 2026) and GTM blueprint restructure

## Verticals cutover (2026-09-23) — reset + reseed under the multi-vertical model

Run in this order. Step 1 and 5 to 6 run from this folder with `.env.local`
(service role); step 2 is a paste into the Supabase SQL Editor.

1. Backup (read-only): `node scripts/export-live.mjs` -> `backups/<timestamp>/`.
   The summary prints blueprint vs user-created task counts.
2. Reset: paste the ENTIRE `supabase/RESET_ALL.sql` (now replays 001-016) into
   Supabase Dashboard > SQL Editor > Run. DESTRUCTIVE. Sanity rows at the end
   should read `verticals 0`, `functions 12`, `admin present 1`.
3. Seed GSI + template + Lyzr:
   `node scripts/seed-gtm.mjs --vertical gsi --template --create-lyzr template:gsi-standard`
   (use `--create-lyzr empty` for an empty company-wide vertical instead).
4. Roles and vertical owners from the backup:
   `node scripts/restore-live.mjs --roles backups/<timestamp>`
   `node scripts/restore-live.mjs --vertical-owners gsi=kailash.gm@lyzr.ai,<other owners>`
5. Bring back user-created tasks and live state of blueprint tasks:
   `node scripts/restore-live.mjs --tasks backups/<timestamp> --vertical gsi --merge-blueprint-state`
6. Verify in the app (workspace home shows GSI + Lyzr cards; GSI space has
   Leads Pipeline, Resources and the Report builder; Lyzr does not), then deploy
   (see Deployment below). Users hard-refresh once.

Owner emails: `--owners-only --vertical gsi` still re-applies `scripts/owner-emails.json`.

## GTM blueprint restructure — original go-live runbook (Aug 2026)

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
   node scripts/seed-gtm.mjs --vertical gsi
   ```
   Expected output: 4 categories, 50 channels (12 top + 38 sub), 94 tasks,
   resources, learnings, channel_fields, budget periods, then the owner pass.

4. **Verify in the app**: `npm run dev` → sign in → sidebar shows the 4 GTM
   categories with tier-badged channels; any channel page shows its kanban
   with pre-assigned activity cards, ★ grades, and the Resources & Learnings tab.

## Later: owner emails arrive/change

Re-apply owners only (safe, idempotent — never touches tasks/taxonomy):

```bash
node scripts/seed-gtm.mjs --owners-only --vertical gsi
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
