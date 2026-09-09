# Comms Tracker

> **Taking this project over?** Start at [readme/00-START-HERE.md](readme/00-START-HERE.md) —
> it has the full handover: product requirements, architecture, every secret's purpose,
> a new-hosting setup guide, the migration list, an operations runbook, known issues, and
> a ready-to-paste kickoff prompt for an AI coding agent ([readme/08-PROMPT-0.md](readme/08-PROMPT-0.md)).
> This file below is the original developer README and may lag behind that folder.

Internal Lyzr tool reconciling **Cortex** (who's engaged, on what product),
**HubSpot** (who's a customer), and **Instantly** (what's actually been sent)
into one dashboard — so customer product-update cadence stops falling through
the cracks. Full design in `/Users/apple/.claude/plans/alright-here-is-what-graceful-pretzel.md`.

Stack: Next.js (static export) + Supabase (Postgres/RLS) + Cloudflare Workers,
mirroring the conventions of the sibling `GSI Tracker/tracker` app.

## Status

- [x] App shell, Google SSO (restricted to `@lyzr.ai`), base layout/nav
- [x] Cortex / HubSpot / Instantly adapters + sync, real credentials in `.env.local`
- [x] Task workflow (Compose & Send still goes through Gmail/Outlook, not Instantly)
- [x] Account → Projects → Stakeholders hierarchy, admin-configurable project roles
      (`supabase/migrations/006_projects_and_roles.sql`)
- [x] 4-shade going-dark severity, per project, rolled up to the account row
- [x] Knowledge base (Lyzr blog/case studies, Slack, and Google Drive — per-user
      OAuth consent, migration `008_user_oauth_tokens.sql` — all fully implemented;
      internal-email still scaffolded — see `SETUP_INTEGRATIONS.md`) + Sonnet-only
      topic suggestions/drafts (`supabase/migrations/007_knowledge_base.sql`)
- [x] Gmail/Outlook compose-handoff send flow (`lib/compose.ts`) — the app never
      sends on the user's behalf, only opens a pre-filled compose window
- [x] Dedicated per-project detail page (`/projects?id=`) — stakeholders, email
      timeline, and the "Generate & Send" modal are wired in
- [x] Schema applied to the live Supabase project; `npx tsx scripts/run-sync.ts all`
      verified working end-to-end (Cortex 54 accounts, HubSpot 79k+ records,
      Instantly) — see git history for 3 sync bugs found/fixed getting here
- [x] Admin "Reassign / Assign owner role" picker on the project page
      (`components/projects/reassign-role-modal.tsx`), backed by the
      Lyzr-internal people list; manual picks are locked against future syncs
- [x] Slack ingestion verified with a real run (5 channels); lyzr.ai scrape
      verified after fixing sitemap-index handling (457 pages discovered,
      ingested 60 per run, unseen pages and case studies first)
- [ ] Migration `008_user_oauth_tokens.sql` not yet run on the live Supabase
      project (Drive connect fails with a missing-table error until it is)
- [ ] Live Worker is the 2026-08-19 build: `/projects`, `/admin/roles` and
      every route except `/api/sync/*` are missing there. Redeploy needs
      `wrangler login`, the secrets below, then `npm run cf:deploy`
- [x] Mailbox reading for Gmail and Outlook (`lib/mail/*`, migration
      `009_mailbox_sync.sql`): per-user connect on `/admin/sync`, emails with
      tracked contacts logged as communication events, "sent via app" rows
      confirmed against real sent mail, siva@ emails feed the internal-email
      knowledge store, weekly via cron
- [ ] Google: enable the Drive + Gmail APIs and add `drive.readonly` +
      `gmail.readonly` to the OAuth consent screen, then click "Connect Gmail"
- [x] OneDrive + SharePoint knowledge source through the same Microsoft
      connection (`lib/knowledge/onedrive.ts`, migration `010_onedrive_sharepoint.sql`)
- [ ] Outlook + OneDrive/SharePoint: needs the Azure app registration (`SETUP_INTEGRATIONS.md`),
      then `MS_GRAPH_CLIENT_ID`/`TENANT_ID` in `wrangler.jsonc` and
      `wrangler secret put MS_GRAPH_CLIENT_SECRET`, then "Connect Outlook"

## Setup

1. `npm install`
2. Copy `.env.local.example` → `.env.local` is already done; fill in
   `SUPABASE_SERVICE_ROLE_KEY` from the Supabase dashboard (Project Settings → API).
3. Paste each `supabase/migrations/*.sql` file into the Supabase Dashboard's
   SQL Editor (Dashboard → SQL Editor → New Query) and run them **in order**
   (001 through 010) — Supabase has no separate migration runner, so this is
   still a manual, one-file-at-a-time step.
4. In Supabase Auth settings, enable the Google provider and add
   `<your-deployed-url>/auth/callback/` (and `http://localhost:3000/auth/callback/`
   for local dev) as a redirect URL.
5. `npm run dev` — sign in with an `@lyzr.ai` Google account.

## Deploy (Cloudflare)

```
npm run cf:build     # opennextjs-cloudflare build
npm run cf:deploy     # build + wrangler deploy
```

Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `HUBSPOT_ACCESS_TOKEN`,
`INSTANTLY_API_KEY`, `CORTEX_API_KEY`, `ANTHROPIC_API_KEY`, and optionally
`SLACK_BOT_TOKEN` / `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` /
`MS_GRAPH_CLIENT_SECRET` — see `SETUP_INTEGRATIONS.md`) must be set via
`wrangler secret put <NAME>` before deploying — never committed, never in
`wrangler.jsonc`'s `vars`.

Refreshes do **not** run inside the Worker: Cloudflare caps the outbound
API calls per Worker request ("Too many subrequests") and every sync
exceeds it. All refreshes run on GitHub Actions
(`.github/workflows/comms-tracker-refresh.yml`): a daily schedule at
12:00 AM IST plus `workflow_dispatch`, which the `/admin/sync` Refresh
buttons trigger through the Worker's `/api/refresh/:target` route (needs the
`GH_DISPATCH_TOKEN` Worker secret and the `CT_*` repo secrets). Same scripts
as local: `scripts/run-sync.ts`, `run-mail-sync.ts`, `run-knowledge-sync.ts`.

The Worker is path-mounted at `lyzr.kailash-gm.com/abm-tracker` (see
`wrangler.jsonc`'s `routes`) rather than a default `*.workers.dev` subdomain —
worth revisiting since that's a personal domain, not a Lyzr-owned one.
