# Lyzr Antigravity Workspace, Knowledge Base

> **Purpose.** Single source of truth for everything in this workspace: what each
> component is, how it is built, how it deploys, and the corrections made over
> time. Read this first before building or changing anything.
>
> **Maintenance rule.** Update this file on **every push**. Add a dated entry to
> the [Build Log & Corrections](#13-build-log--corrections) section with the
> latest build specs and any corrections made. Keep the component sections in
> sync when behavior changes.
>
> **Brand convention.** No em dashes in any copy (Lyzr style, spec section 18).
>
> | | |
> |---|---|
> | **Last updated** | 2026-06-09 |
> | **Maintained by** | subs@lyzr.ai (with Claude Code) |
> | **Git repo** | `github.com/kailcodes02-gif/lyzr` (branch `main`) |
> | **Live domain** | `https://lyzr.kailash-gm.com` |
> | **Repo root on disk** | `/Users/apple/Documents/Work/Lyzr/Antigravity/` |

---

## Table of contents

1. [What this workspace is](#1-what-this-workspace-is)
2. [Repository & deployment model](#2-repository--deployment-model)
3. [Top-level directory map](#3-top-level-directory-map)
4. [Component: Work OS root site](#4-component-work-os-root-site)
5. [Component: Weekly GSI Reports](#5-component-weekly-gsi-reports)
6. [Component: Pipeline dashboard](#6-component-pipeline-dashboard)
7. [Component: Prototypes / demo_pipeline](#7-component-prototypes--demo_pipeline)
8. [Component: GSI Tracker (Next.js app)](#8-component-gsi-tracker-nextjs-app)
9. [Shared data files](#9-shared-data-files)
10. [Authentication summary](#10-authentication-summary)
11. [Conventions & gotchas](#11-conventions--gotchas)
12. [Known drift, discrepancies & open items](#12-known-drift-discrepancies--open-items)
13. [Build Log & Corrections](#13-build-log--corrections)

---

## 1. What this workspace is

A single Git repo (`lyzr`) that hosts several loosely related internal Lyzr tools
under one Cloudflare Pages site at `lyzr.kailash-gm.com`. The pieces:

| Component | Path | Live URL | Status |
|---|---|---|---|
| Work OS landing/hub | `index.html`, `control/`, `tasks/` | `/` | Live |
| Weekly GSI Reports | `reports/` | `/reports/` | Live, active |
| Pipeline dashboard | `pipeline/` + root `functions/api/` | `/pipeline/` | Live, actively edited |
| Prototypes (public demos) | `prototypes/` | `/demo_pipeline/` | Live |
| GSI/SI Marketing Tracker | `GSI Tracker/tracker/` | (none, local only) | In development |

Two of these are the day-to-day active work: the **weekly GSI reports** (new HTML
report per week) and the **pipeline dashboard** (live edits committed back to git).
The **GSI Tracker** is a separate, larger Next.js app still in development and is
**not** part of the Cloudflare deploy.

---

## 2. Repository & deployment model

### One repo, one Cloudflare Pages project

- **Repo:** `github.com/kailcodes02-gif/lyzr`, branch `main`.
- **Deploy target:** Cloudflare Pages project `lyzr-work-os`, served at `lyzr.kailash-gm.com` (domain set by root `CNAME`).
- **Trigger:** GitHub Actions workflow `.github/workflows/deploy.yml` runs on every push to `main`. It runs `wrangler pages deploy . --project-name=lyzr-work-os`, i.e. **the entire repo root is published as static assets + Pages Functions**. Typical deploy time ~30s.

### Secrets set on Cloudflare Pages by the workflow

The deploy workflow pushes these Pages secrets (so the `functions/` API can read/write data via the GitHub Contents API):

- `GITHUB_OWNER` = `kailcodes02-gif`
- `GITHUB_REPO` = `lyzr`
- `GITHUB_PATH` = `pipeline/data.json`
- `GITHUB_BRANCH` = `main`
- `GITHUB_TOKEN` = a Personal Access Token, sourced from whichever of these GitHub repo secrets exists: `GH_PAT`, `PERSONAL_ACCESS_TOKEN`, or `PAT`.

GitHub Actions secrets required: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and one PAT secret above.

### Cloudflare Pages Functions (the live API)

The **deployed** API lives at the **repo root** under `functions/api/` (Cloudflare Pages auto-mounts the root `functions/` dir):

- `functions/api/data.js` -> `GET /api/data` (reads `pipeline/data.json` from GitHub)
- `functions/api/rows.js` -> `POST /api/rows` (create) and `PUT /api/rows?id=` (edit)
- `functions/api/rows/[id].js` -> `PUT /api/rows/:id` (edit by path param)
- `functions/api/snapshot.js` -> `POST /api/snapshot` (write dated aggregate snapshot) and `GET /api/snapshot` (list / fetch by `?date=`). Added 2026-06-02 for trend tracking.

> **Note:** `pipeline/functions/` and `pipeline/api/` contain near-duplicate copies
> of these handlers. They appear to be legacy/source copies; Cloudflare serves the
> **root** `functions/` dir, so treat the root copies as authoritative and keep the
> two in sync (or remove the pipeline copies) to avoid confusion.

### Root static config

- `CNAME` -> `lyzr.kailash-gm.com`
- `_redirects` -> rewrites `/demo_pipeline/*` to serve `/prototypes/index.html` (URL stays `/demo_pipeline/`).
- `_headers` -> `/control/*` is `noindex, nofollow`, `X-Frame-Options: DENY`, `no-store`; `/demo_pipeline/*` allows framing (`ALLOWALL`, `frame-ancestors *`) so it can be embedded.
- `.gitignore` -> ignores `.DS_Store`, `antigravity-prompt.md`, wrangler/`.dev.vars*`/`.env*` files.

### Cloudflare Worker (separate from Pages)

`cloudflare/wrangler.toml` defines a Worker named `wos-auth` (`worker.js`, compat date 2024-04-17) with USERNAME/PASSWORD vars set in the dashboard. `cloudflare copy/worker.js` is a backup. This is the basic-auth gate layer and is distinct from the Pages deploy.

---

## 3. Top-level directory map

```
Antigravity/                      (git repo root, deploys to Cloudflare Pages)
├── index.html                    Work OS landing/hub page
├── README.md                     Work OS one-pager
├── CNAME, _headers, _redirects   Cloudflare Pages routing/headers
├── .github/workflows/deploy.yml  Deploy-on-push to lyzr-work-os
├── functions/api/                LIVE Pages Functions (data.js, rows.js, rows/[id].js)
├── cloudflare/                   wos-auth Worker (wrangler.toml + worker.js)
├── cloudflare copy/              backup of the worker
├── control/                      Admin/control panel (auth-gated, noindex)
├── tasks/                        Weekly tasks index (reads data/weeks.json)
├── reports/                      Weekly GSI reports + dynamic index
├── pipeline/                     Pipeline dashboard (index.html, data.json, server.js, generate_data.py, snapshots/)
├── prototypes/                   Public demos dashboard (served at /demo_pipeline/)
├── data/                         Shared JSON: weeks.json, channel-owners.json
├── docs/                         Runbooks: cloudflare-access, google-sheets-sync, weekly-report
├── scripts/                      drive-watcher.gs, cognis-api/, github-commit/, sheet-sync/
├── report/                       Legacy/prototype report (day3/)
├── Work OS/                      Separate worker project files (sibling)
├── GSI Tracker/                  Next.js tracker app + spec/docs (NOT deployed)
└── KNOWLEDGE_BASE.md             This file
```

---

## 4. Component: Work OS root site

- **`index.html`** is the landing hub ("Work OS, Kailash"). Two cards link to `/tasks/` and `/reports/`. Includes a session-based login modal (sessionStorage key `wos_auth`) that gates `/control/`.
- **`control/index.html`** is an admin dashboard (system health, metrics submission, memory audit, manual triggers). `noindex, nofollow`; auth checked via sessionStorage.
- **`tasks/index.html`** lists weeks by fetching `/data/weeks.json` and renders cards linking to `/tasks/week-{n}/`. Has a `<noscript>` fallback.
- **`README.md`** describes the Work OS concept: agents output `{ html_page, notion_payload }`, delivered via Make.com (HTML -> GitHub, JSON -> Notion), Cloudflare auto-deploys on push.

---

## 5. Component: Weekly GSI Reports

The most actively updated public artifact. Each week gets a self-contained HTML report.

### How it works

- **`reports/index.html`** fetches `/data/weeks.json?t={timestamp}` on load and renders week cards (newest first), each linking to that week's report `path`. It has a `<noscript>` static fallback and a hidden AI-scraper description block.
- **Individual reports** are static, self-contained HTML (inline CSS + minimal JS for animation only). Dark theme (`--bg: #0c0a08`, text `#f0ebe4`), Google Fonts (Playfair Display, DM Sans, Inter).
- **`reports/week-template/`** holds a reference template (`Week 18-22.html`) and a loading placeholder `index.html`.

### Report structure (sections in a typical report)

Topbar (logo, title, nav pills) -> `gsi-w` widget (`whead` title/filters/KPI badge, `wkpis` KPI grid) -> `week-header` badges (past/current/pipeline/overview) -> `channel-block` per channel (LinkedIn, Email, Co-Marketing, Ads, Events, Automation, Social, Content, etc.) -> `metrics-grid`, `insight-box` callouts (rose/blue/amber/green), `mini-table`, `iframe-wrap` embeds.

### Path conventions (note the inconsistency)

Reports are referenced from `weeks.json` three different ways, so always check `weeks.json` for the real path:

- Subdirectory with `index.html`: e.g. `week_April_18to22`
- Direct file at `reports/` root: e.g. `gsi-report-may25-31.html`
- Nested file: e.g. `week_May_17to24/gsi-report-may17-24.html`

### Current report files (in `reports/`)

`gsi-report-apr22-30.html`, `gsi-report-may10-17.html`, `gsi-report-may17-24.html`, `gsi-report-may25-31.html`, plus `week_*` subdirectories for earlier weeks.

### Adding a new week

1. Create the report HTML in `reports/` (copy an existing recent report as the base).
2. Add/append the week entry in `data/weeks.json` (number, date_range, path, status, meetings_processed) and bump `current_week` + `last_updated`.
3. Commit and push. Cloudflare redeploys; `/reports/` picks up the new card automatically.

---

## 6. Component: Pipeline dashboard

Internal use-case / opportunity tracker. Single-page app that reads and writes a JSON file in the repo, with edits committed straight back to git through the Pages API.

### Files

- **`pipeline/index.html`** (~2300 lines): Alpine.js 3.13.10 + Chart.js 4.4.4 + precompiled Tailwind (`styles.css`, not CDN) + Google Identity Services. Tabs: Home, Internal, Accenture, GSI/SI, Enterprises, Live Demos. Home shows KPI strip, ACV breakdown, pipeline heatmap, owner leaderboard, top accounts. Segment views have filters (stage/category/industry/owner), ACV buckets, sortable table, search, CSV export, and an Add/Edit drawer.
- **`pipeline/data.json`** (~230KB): the data the dashboard reads. Schema below.
- **`pipeline/server.js`**: an Express server (`express`, `cors`) for **local dev only**, exposing the same `GET /api/data`, `POST /api/rows`, `PUT /api/rows/:id` against the local `data.json`. Production uses the root `functions/` instead.
- **`pipeline/styles.css`**: precompiled Tailwind. Do not hand-edit; regenerate via `rebuild-styles.sh` if classes change (build files like the rebuild script and `tailwind.config.js` may live locally, not in the deployed repo).
- **`pipeline/_headers`**: caches `data.json` for 60s so edits show quickly.
- **`pipeline/README.md`**: detailed deploy + data-refresh + OAuth setup notes.

### `data.json` shape

```jsonc
{
  "generated_at": "<ISO timestamp>",
  "source_file": "tracker.xlsx",
  "rows": [ /* row objects, see below */ ],
  "aggregates": { /* recomputed on every write */ },
  "facets": { "segments": [...], "stages": [...], "categories": [...], "industries": [...] }
}
```

A **row** (segment-prefixed id, 13 editable fields):

```jsonc
{
  "id": "INT-0001",            // prefix per segment: INT/ACC/GSI/ENT + 4-digit
  "segment": "Internal",       // Internal | Accenture | GSI-SI | Enterprises
  "sn": 1,                      // global sequential number
  "company": "...", "industry": "...", "project": "...", "use_case": "...",
  "category": "...",
  "stage": "Demo",             // Demo | in-conversation | win | customer | lost
  "prototype_owners": [], "opportunity_owners": [],
  "prototype_link": "https://...", "prototype_link_text": "...",  // text auto-synced from link
  "acv": null, "acv_raw": null,                                    // raw auto-synced from acv
  "time_period": null, "close_date_raw": null, "close_quarter": null,
  "created_by": "...", "created_at": "<ISO>",
  "edit_history": [ { "edited_by": "...", "edited_at": "<ISO>", "changes": { "field": {"old": ..., "new": ...} } } ]
}
```

> Aggregate numbers (total ACV, by_segment counts, leaderboard, top companies) are
> **recomputed automatically** on every write, so do not hardcode them. Segment
> deal counts shift as rows are added. As of the pipeline README's fidelity note
> the source reconciled to ~345 rows; trust the live `data.json`, not snapshots.

### The edit / commit flow (this is the source of `data: edit ...` commits)

1. User edits/adds a row in `pipeline/index.html`, which calls `POST /api/rows` or `PUT /api/rows?id=`.
2. The **root** Pages Function (`functions/api/rows.js`) verifies a Google Bearer token (`@lyzr.ai` only), fetches current `pipeline/data.json` from GitHub (with its SHA), applies the change, records the diff into `edit_history` (capped at the last 3 edits), recomputes aggregates, and **commits back to GitHub**:
   - Create: `data: add project "{project}" [{id}] by {email}`
   - Edit: `data: edit "{project}" [{id}] by {email}`
3. The push triggers a Cloudflare redeploy; the dashboard reflects the change within ~30s (data.json cached 60s).

### Refreshing data from the source spreadsheet

Per `pipeline/README.md`: drop a new `tracker.xlsx` into the pipeline folder and run `python3 generate_data.py tracker.xlsx data.json`, then commit + push. **`generate_data.py` now exists** (added + smoke-tested 2026-06-02; needs `openpyxl`). `tracker.xlsx` is still not committed (provide it to run the generator). For live sync from Google Sheets instead, see `docs/google-sheets-sync.md` + `scripts/sheet-sync/`. The normaliser handles `"a"` -> blank, owner splitting on `,` and `/`, name canonicalisation (e.g. `Bharath` -> `Bharath Bhat`), ACV string -> number, and URL validation for prototype links.

---

## 7. Component: Prototypes / demo_pipeline

- **`prototypes/`** is a public, no-auth dashboard of live demos, served at `/demo_pipeline/` (via `_redirects`) and embeddable (framing allowed via `_headers`).
- Reads the **same** `pipeline/data.json`, but shows only rows with a `prototype_link`, grouped by company then category, with search + company filter. Dark glassmorphism theme (`styles.css`).
- Has both a Vercel serverless function (`api/data.js`) and a Cloudflare Pages function (`functions/api/data.js`) so it can host on either platform. `vercel.json` present for the Vercel option.

---

## 8. Component: GSI Tracker (Next.js app)

The largest in-progress piece. Internal task/tracker/budget tool for Lyzr's GSI/SI
marketing team (~10-50 `@lyzr.ai` users). **Local dev only, not in the deployed
repo, no hosted deployment yet.** Lives at `GSI Tracker/tracker/`.

### Canonical docs (read before building on the tracker)

- **`GSI Tracker/lyzr-marketing-tracker-spec-v2.md`** (~1600 lines): full PRD/build spec. Data model in section 5, RLS in 6, channel field seeds in 8, views in 10, sprint plan in 14, v2 backlog in 15, conventions in 18.
- **`GSI Tracker/knowledge_transfer.md`**: handover summary of what is built (Phase 2/3 features, env vars, parked items).
- **`GSI Tracker/tracker/DECISIONS.md`**: architectural decisions D1-D10.
- **`GSI Tracker/tracker/BACKLOG.md`**: parked features by phase.
- When spec and code disagree, treat the **spec as authoritative on intent** and the **code as authoritative on current state**. See [Known drift](#12-known-drift-discrepancies--open-items).

### Stack

- Next.js **16.2.6** (App Router), React **19.2.4**, TypeScript 5.
- Tailwind **v4** via `@tailwindcss/postcss`, CSS variables in `globals.css` (no `tailwind.config.js`).
- shadcn/ui (`shadcn` 4.8.2) built on `@base-ui/react` 1.5.0; `lucide-react` icons; `sonner` toasts; `cmdk`.
- Supabase: `@supabase/ssr` + `@supabase/supabase-js` (auth + DB + storage).
- `@tanstack/react-query` for client data state.
- `react-day-picker` 10 (calendar), `@dnd-kit/*` (drag/drop), `react-hook-form` + `zod` + `@hookform/resolvers`, `papaparse` (CSV), `date-fns` + `date-fns-tz` (IST formatting).

### Data flow

- **Writes:** Next.js Server Actions in `lib/actions/index.ts` using the Supabase **service role key** (admin checks inside).
- **Reads:** client-side Supabase JS + query hooks in `lib/hooks/use-data.ts` (anon key, gated by RLS).
- **Timezone:** stored UTC, displayed Asia/Kolkata (IST). **Currency:** USD only.
- **Auth:** Google SSO restricted to `@lyzr.ai`. Roles: `admin` | `member` only. Admin seeded at first run: `kailash.gm@lyzr.ai`.

### Route map (`app/`)

Authenticated group `app/(app)/`:
`/` (dashboard), `/admin` (taxonomy + users + HubSpot), `/budgets`, `/calendar`,
`/category/[slug]`, `/channel/[id]`, `/leads`, `/me/calendar`, `/my-tasks`,
`/notifications`, `/owners` + `/owners/[email]`, `/tracker`, `/weekly`.
Unauthenticated: `/login`.

API routes (`app/api/` + `app/auth/`):
- `auth/callback/route.ts` (Supabase redirect)
- `api/auth/hubspot/route.ts` (start HubSpot OAuth, `crm.objects.contacts.read`)
- `api/auth/hubspot/callback/route.ts` (exchange code, encrypt tokens, store, initial sync)
- `api/cron/hubspot-sync/route.ts` (sync contacts; Bearer token or `?bypass=true`)
- `api/cron/weekly-snapshot/route.ts` (aggregate weekly metrics, write `weekly_snapshots`, queue Slack notification)

### `lib/`

- `actions/index.ts` (~1230 lines): all mutations, task CRUD with recurring auto-generation, dependencies, assignments (+ `assignTaskByEmail` -> pending_assignments), checklists, comments, mentions (+ pending_mentions), budgets, notifications, file upload (`task-results` bucket), lead import (dedupe by email), invites via Resend, taxonomy CRUD, `queueSlackNotification`.
- `supabase/{client,server,middleware}.ts`: browser client, server clients (`createClient` user-scoped + `createServiceClient` admin), `updateSession`.
- `hubspot/index.ts`: AES-256-GCM encrypt/decrypt, token refresh, `syncHubSpotContacts`.
- `hooks/use-data.ts`, `hooks/use-weekly.ts`; `email/resend.ts`; `types/database.ts`; `utils.ts` (`cn`).

### Database migrations (`supabase/migrations/`, applied in order)

1. `001_initial_schema.sql` (20KB): enums + core tables (users, categories, channels, tasks, task_assignments, task_comments, checklist_items, channel_fields, task_dependencies, recurring_templates, activity_log, notifications, mentions, pending_mentions, budget_periods, slack_settings) + indexes + base RLS.
2. `002_phase2_schema.sql`: Phase 2 tables/columns.
3. `003_pending_slack_notifications.sql`: Slack queue table (status pending/sent/failed).
4. `004_hubspot_tables.sql`: `hubspot_connection` + `hubspot_synced_contacts` (+ RLS).
5. `005_apply_phase2_and_3_idempotent.sql`: idempotent re-apply (CREATE IF NOT EXISTS).
6. `006_seed_channel_fields.sql` (95KB): seeds channel field definitions (planning + tracker surfaces).
7. `007_invites_and_pending_assignments.sql`: `pending_invites` + `pending_assignments` + `handle_new_user` trigger that materialises pending invites/assignments/mentions on first sign-in.
8. `008_rls_hardening.sql`: tightened granular RLS policies.
9. `009_saved_views.sql`: per-user `saved_views` table (page + name + JSONB config, unique per user/page/name, own-rows RLS). Added 2026-06-02 for the Saved Views feature. Bulk Operations (same date) needed no migration.

### Components (`components/`)

`providers.tsx`, `layout/app-shell.tsx` (sidebar + header), `tasks/` (channel-fields, create-task-dialog, task-card, task-detail, task-view), and shadcn `ui/` primitives (avatar, badge, button, calendar, card, checkbox, command, dialog, dropdown-menu, input, input-group, label, popover, progress, scroll-area, select, separator, sheet, switch, table, tabs, textarea, tooltip).

### Config

- `middleware.ts`: calls `updateSession`; matcher excludes `api`, `_next/*`, and static asset extensions.
- `next.config.ts`: effectively empty.
- `.env.local` keys present: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `ENCRYPTION_SECRET` (must be exactly 32 chars). The KT doc also lists `CRON_SECRET` as required by the cron routes, but it is **not currently in `.env.local`** (see open items).
- Single Supabase project: `xyefbslbihjdczlzjatu` (no separate staging/prod).
- Email: Resend with console fallback. If `RESEND_API_KEY` is unset, `lib/email/resend.ts` logs the would-be email and the invite flow still records a `pending_invites` row.

### Parked backlog (high level)

Phase 4 polish and beyond: task templates, formula engine, AI weekly-review summary, per-instance recurring exceptions, notification preferences, approval gates, KPI dashboards, budget-spend tracking, saved views, bulk ops, multi-currency, GCal sync, monthly report generator. Explicitly never: public task sharing, email-to-create, mobile native, real-time multiplayer cursors, HubSpot writes, multi-business-unit, delegated channel-admin role.

---

## 9. Shared data files

### `data/weeks.json`

Central registry the reports and tasks indexes read. Keys: `current_week`,
`start_date`, `timezone` (`Asia/Kolkata`), `last_updated`, and `weeks[]` (each:
`number`, `date_range`, `path`, `status`, `meetings_processed`). Currently 6 weeks,
`current_week: 6` (May 25 to May 31). Update this whenever a report is added.

### `data/channel-owners.json`

Registry of Marketing channels plus Sales/Solution/Product teams. Each entry has
`team`, optional `category`, `channel`, `owners[]`, `notes[]`, and optional `pod`,
`sheet_name`, `form_url`, `metrics[]`, `nudge_cadence_days`. Covers channels like
Design, Video, SEO/GEO, Blogs/Content, Community, Social, Twitter, G2, Podcast,
CRM, Email Outreach, Website/LP, Events, Partnerships, LinkedIn Ads, Performance,
plus Sales (AE, SDR), DevRel, and Product. Used for report generation / owner
attribution; not directly embedded in report HTML.

---

## 10. Authentication summary

Three distinct auth layers (do not conflate them):

| Surface | Mechanism | Restriction |
|---|---|---|
| Pipeline dashboard + write API | Google Identity Services, client-side; Bearer token verified server-side in `functions/api/*` against Google userinfo | `hd === 'lyzr.ai'` (or `@lyzr.ai` email), `email_verified`; plus one allowlisted gmail in code |
| Work OS `/control/` | username/password modal -> `sessionStorage.wos_auth` | `kailash` / `Kail@lyzr` (test-grade; lockout disabled for testing) |
| GSI Tracker app | Supabase Auth (Google SSO) | domain-restricted to `@lyzr.ai`; roles admin/member |

Client-side OAuth on the pipeline is **bypassable** (static `data.json` is readable
directly). Acceptable for non-confidential internal data; migrate to Cloudflare
Access if the data ever becomes confidential.

---

## 11. Conventions & gotchas

- **No em dashes** anywhere in copy (Lyzr brand). Use commas, colons, or parentheses.
- **Always check `weeks.json` for a report's real path** before linking; the three path styles are inconsistent.
- **The deployed API is the root `functions/`**, not `pipeline/functions/`. Keep duplicates in sync or remove them.
- **Do not hand-edit `pipeline/styles.css`** (precompiled Tailwind) or hardcode `data.json` aggregates (recomputed on write).
- **Every push to `main` auto-deploys the whole repo.** Be deliberate about what you commit; secrets live in Cloudflare/GitHub, never in the repo (`.env*` is gitignored).
- **Pipeline edits commit themselves** with `data: add`/`data: edit` messages from the API; expect these in the log.
- The GSI Tracker is **not** deployed by this repo and is local-only; do not assume `wrangler`/`vercel`/workflow config at the repo root applies to it.
- IST (Asia/Kolkata) everywhere; UTC in storage, IST on display.

---

## 12. Known drift, discrepancies & open items

- **Tracker stack vs spec:** spec says Next.js 14 + React 18 + Vercel; actual is Next.js 16.2.6 + React 19.2.4 with **no deployment** (local only). Intentional (DECISIONS D1). Do not "fix" back to spec.
- **Tracker deploy target:** `DECISIONS.md` D5 says "Vercel for deployment," but the tracker is not actually deployed anywhere yet. The Cloudflare config at the repo root deploys the **sibling** Work OS site, not the tracker.
- **`CRON_SECRET`:** RESOLVED (2026-06-02) — added to `tracker/.env.local`. Cron routes also still accept `?bypass=true` (flagged as a design choice, not changed).
- **Slack integration:** queue table exists (`pending_slack_notifications`, migration 003) but the dispatcher is parked / not built.
- **Calendar lib:** spec called for `react-big-calendar`; actual uses `react-day-picker`.
- **Cron model:** spec called for Supabase Edge Functions; actual uses Next.js API routes secured by `CRON_SECRET` (would need external cron to hit them once hosted).
- **`generate_data.py`:** RESOLVED (2026-06-02) — written and smoke-tested at `pipeline/generate_data.py` (needs `openpyxl`). **`tracker.xlsx`** still not present; provide it to regenerate `data.json` from the spreadsheet.
- **Duplicate pipeline functions:** RESOLVED (2026-06-02) — `pipeline/functions/` and `pipeline/api/` deleted; root `functions/api/` is the only served copy.
- **Sheets sync secrets:** `scripts/sheet-sync/` + `.github/workflows/sheet-sync.yml` are built but inert until `GOOGLE_SERVICE_ACCOUNT_JSON` + `GOOGLE_SHEET_ID` secrets are set and the schedule is uncommented. See `docs/google-sheets-sync.md`.
- **Cloudflare Access:** runbook at `docs/cloudflare-access-setup.md`; the actual gating is a dashboard action only the user can perform.

---

## 13. Build Log & Corrections

> **Append a dated entry here on every push.** Note what was built/changed, which
> files, the commit(s), and any correction to earlier behavior. Newest first.

### 2026-06-08, Week 7 GSI report (1–8 June) published to `/reports`
- Added `reports/gsi-report-jun1-8.html` — the 1–8 June weekly GSI/SI marketing report.
  Built from the `may25-31` template (shared CSS / pipeline widget / chart script) with a
  fresh HubSpot snapshot (88 conversations, 18 partners = Accenture + 17 GSIs/SIs; 14 won,
  16 lost, 42 demos, 16 in-conversation), this week's channel updates, the June–July content
  calendar, and the 14-item to-do pipeline.
- Registered as a bubble: `data/weeks.json` (added week 7, `current_week`→7, `last_updated`→2026-06-08)
  drives the index's dynamic list; mirrored the static `<noscript>` card + AI-scraper summary
  line in `reports/index.html`.
- Source arrived UTF-8-mojibaked again. Avoided the garble entirely by reconstructing from the
  clean template and splicing only the new JSON + body with context-resolved glyphs (`·`, `—`/`–`,
  `→`, `↗`, `★`, channel emoji). 0 stray bytes; embedded JSON parses; divs balanced 399/399.
- Same em-dash caveat as the GTM entry below: report copy uses em dashes (consistent with the
  existing weekly reports, contrary to spec §18 no-em-dash). Preserved as-supplied, not re-copyedited.
- **Data note:** the new snapshot renamed/deduped several deals vs. week 6 (e.g. "Accenture 1M
  Product Team" → "1M Product Team"; some Movate Pipeline rows replaced). Taken verbatim from the
  supplied report; flag for owners if week-over-week label continuity matters.

### 2026-06-09, GSI/SI GTM strategy page published at `/GSI_GTM`
- Added `GSI_GTM/index.html` — a standalone interactive "GSI & SI Growth Engine"
  strategy view (objective-lens / channel-group-lens toggle, funnel filters, 42
  activities across 9 channel families). Self-contained single file; no shared deps.
- Serves at `https://lyzr.kailash-gm.com/GSI_GTM` via the existing root Cloudflare
  Pages deploy (folder + `index.html`, same pattern as `control/`, `reports/`).
- The source HTML arrived UTF-8-mojibaked (`Â·`, `â€"`, card arrow). Repaired
  deterministically: `·` middot, `▸` disclosure triangle, `✕` clear button,
  context-resolved `—` em / `–` en / `→` flow arrows. 0 stray bytes remaining.
- **Note:** this artifact's copy uses em dashes, which is contrary to the Lyzr
  no-em-dash brand convention (spec §18). Preserved as-authored since the page was
  supplied to host verbatim, not to re-copyedit. Flag for owners if they want it conformed.

### 2026-06-02, GSI Tracker hardening + first tests (local only, separate product, not pushed)
Tracker-only pass; kept local (the tracker is now treated as its own product with its own git, TBD).
- **7**: fixed the pre-existing `PopoverTrigger asChild` type error in `tracker/page.tsx` (base-ui Trigger renders a button; merged styles, dropped the nested button + invalid prop). `npx tsc --noEmit` now exits 0.
- **5a**: cron routes (`weekly-snapshot`, `hubspot-sync`) no longer honor `?bypass=true` in production and now require `CRON_SECRET` (previously auth was skipped if the secret was unset).
- **5b**: `createMention` trims + lowercases the email so mentions resolve regardless of case.
- **5c**: recurring template `next_due_date` is now one interval after the first instance (was the same day, so the 2nd instance used to land on the 1st's date).
- **5d**: `updateTask` now blocks closing a task while its blocker dependencies are open, unless `overrideBlockers` is passed; the drawer's existing confirm now passes that override. Previously client-only / bypassable.
- **8**: pure logic extracted to `lib/task-logic.ts`; added vitest (`npm test`) + `lib/task-logic.test.ts` (12 tests, all passing) covering the 5b/5c/5d fixes.
- Phase 4 polish (C) explicitly out of scope.

### 2026-06-02, Bug-fix + Phase 4 + Section D sweep (working tree, NOT yet committed)
Multi-agent pass (3 background agents, partitioned by component). Two agents stalled
on long commands and were recovered/finished in the foreground. All verified; nothing
committed yet (commit deferred per user). Summary of changes now in the working tree:

- **Pipeline / live write API** (`functions/api/`): fixed a real concurrency bug. The
  GitHub read-modify-write now retries on a SHA conflict (409/422) via `commitWithRetry`,
  so racing edits no longer silently clobber each other. Also: ACV NaN-guard, segment
  validation, and a guard in `data.js` for GitHub's non-base64 / >1MB response. All JS
  syntax-checked.
- **Dedupe done**: deleted the stale duplicate `pipeline/functions/` and `pipeline/api/`
  dirs. Root `functions/api/` is the single source.
- **`pipeline/generate_data.py`** created and smoke-tested against a synthetic xlsx
  (every normalization rule passes: blank-token, owner split, name canonicalization,
  ACV parse, quarter derivation, URL validation, segment-from-sheet ids, BFSI facet).
  Needs `openpyxl`.
- **"My pipeline" chip** wired in `pipeline/index.html` (ownerEmailMap + resolver +
  predicate). 3 owner emails confirmed, ~8 inferred and TODO-tagged.
- **Snapshot history** added: `functions/api/snapshot.js` (POST writes
  `pipeline/snapshots/<date>.json`; GET lists/returns). Dual auth: @lyzr.ai Bearer OR
  `X-Snapshot-Secret` for cron.
- **GSI Tracker**: `CRON_SECRET` added to `.env.local`; bug hunt found no clear bugs
  (4 judgment-call items reported, not changed); Phase 4 #19 **Saved Views** (migration
  `009_saved_views.sql` + action + hook + UI) and #20 **Bulk Operations** (actions +
  multi-select UI) implemented. `npx tsc --noEmit`: 0 new errors (1 pre-existing
  `PopoverTrigger asChild` error in tracker/page.tsx, not ours).
- **Static-site bug fixes**: `index.html` (orphaned `gear-btn` handler threw on every
  load, killing the login script) and `control/index.html` (deleted `#auth-check`
  reference) null-guarded.
- **Docs** (`docs/`): `cloudflare-access-setup.md`, `google-sheets-sync.md` (updated to
  Option B service-account, the chosen path), `weekly-report-runbook.md`.
- **Sheets sync (Option B)** built: `scripts/sheet-sync/sync_from_sheets.py` (+ requirements)
  and `.github/workflows/sheet-sync.yml` (manual-dispatch only; cron commented). Pending
  secrets: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`.
- **Decisions captured**: multi-currency dropped (USD-only stands); bug fixes scoped to
  clear bugs only.

### 2026-06-01, Knowledge base created
- Created this `KNOWLEDGE_BASE.md` at the repo root after a full pass over the
  workspace (deployment, reports, pipeline, prototypes, GSI Tracker, data files).
- No code/behavior changes; documentation only.
- Reflects current state: 6 weekly reports (through May 25-31), `current_week: 6`
  in `weeks.json`, pipeline live with self-committing edits, GSI Tracker at
  migration `008_rls_hardening.sql`, Next 16.2.6 / React 19.2.4.

<!-- Template for new entries:
### YYYY-MM-DD, <short title>
- What changed and why
- Files touched: ...
- Commit(s): <hash> <message>
- Corrections to prior behavior/docs (if any)
-->
