# Architecture and Current Hosting

This describes what is live **today**, under the outgoing owner's
accounts. [04-HANDOVER-SETUP-GUIDE.md](04-HANDOVER-SETUP-GUIDE.md) covers
moving every piece of this to the new owner's own accounts.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16.2, React 19.2, TypeScript, static export (`output: "export"`) |
| Styling | Tailwind CSS v4 + a small shadcn/ui-style component set (`components/ui/`) |
| Data / auth | Supabase (Postgres + Row Level Security + Auth + Storage) |
| Hosting | Cloudflare Workers, serving the static export directly via a Static Assets binding |
| Background jobs | GitHub Actions (see below for why, not the Worker) |
| AI | Anthropic API, `claude-sonnet-5` exclusively |

The app is a **pure static export with no server-side rendering** — every
page is client-side React talking directly to Supabase with the anon key;
Supabase's Row Level Security is the actual security boundary, not
anything server-side in Next.js. The one Cloudflare Worker
(`worker/index.ts`) does two jobs: serve the static files, and handle a
small number of `/api/*` routes that need a secret the browser must never
see (the Anthropic key, the Supabase service-role key, OAuth client
secrets).

## Why syncing runs on GitHub Actions, not the Cloudflare Worker

A Cloudflare Worker request is capped at a limited number of outbound
subrequests. Even the smallest of the three core syncs (Cortex, ~54
accounts) is fine, but HubSpot alone makes hundreds of API calls to pull
~80,000 records, and Instantly can mean dozens of campaign calls — both
exceed the Worker's limit and fail with "Too many subrequests by single
Worker invocation." So no sync ever runs inside the Worker. Instead:

- `.github/workflows/comms-tracker-refresh.yml` runs on a daily schedule
  (18:30 UTC = 00:00 IST) and on manual dispatch, executing the exact same
  TypeScript scripts (`scripts/run-sync.ts`, `run-mail-sync.ts`,
  `run-knowledge-sync.ts`) you can also run locally.
- The Worker's `/api/refresh/:target` route, which the "Refresh" buttons
  on the Data & Sync page call, does nothing but call GitHub's API to
  dispatch that same workflow (needs the `GH_DISPATCH_TOKEN` Worker
  secret — a GitHub personal access token with `repo`/`workflow` scope).
- Local development (`npx tsx scripts/run-sync.ts all`, etc.) talks
  straight to Supabase with the service-role key from `.env.local` — no
  GitHub, no Worker, no deploy needed to test a sync change.

## Data flow (bird's eye)

```
Cortex  ──┐
HubSpot ──┼──▶ GitHub Actions (scripts/run-sync.ts)   ──▶ Supabase (accounts, projects,
Instantly ┘                                                 people, communication_events)

Gmail   ──┐
Outlook ──┴──▶ GitHub Actions (scripts/run-mail-sync.ts) ──▶ Supabase (communication_events,
                                                               user_oauth_tokens, knowledge_documents)

lyzr.ai / Slack / Drive / OneDrive / meeting notes ──▶ GitHub Actions
    (scripts/run-knowledge-sync.ts)                 ──▶ Supabase (knowledge_documents)

Browser (signed-in user) ──▶ Supabase (read/write, RLS-scoped)
                          └─▶ Cloudflare Worker /api/ai/*  ──▶ Anthropic API (Sonnet)
                          └─▶ Cloudflare Worker /api/oauth/microsoft/* ──▶ Microsoft Graph
                          └─▶ Cloudflare Worker /api/refresh/* ──▶ GitHub Actions (dispatch only)
```

## What is live right now

| Piece | Current value |
|---|---|
| App URL | `https://lyzr.kailash-gm.com/abm-tracker/` |
| Cloudflare Worker name | `abm-tracker`, in the Cloudflare account tied to `kailcodes02@gmail.com` |
| Domain | `lyzr.kailash-gm.com` — **a personal domain belonging to the outgoing team, not a Lyzr-owned domain.** This is the single biggest reason the whole thing needs to move. |
| Git repository | `github.com/kailcodes02-gif/lyzr`, a personal monorepo that also hosts several unrelated internal tools. `comms-tracker/` is one subfolder in it (this handover packages that subfolder to become its own standalone repo). |
| GitHub Actions workflow | `.github/workflows/comms-tracker-refresh.yml` at the **monorepo root** (outside this folder) — a self-contained copy for a standalone repo is already included at `comms-tracker/.github/workflows/comms-tracker-refresh.yml` inside this handover. |
| Supabase project | ref `datdjabcrxveubsvvxvm`, under the outgoing owner's Supabase account |
| Cloudflare account ID | `3621287d8e0a09294e069c9a56f983ed` (personal) |

## Worker API routes (`worker/index.ts`)

| Route | Purpose |
|---|---|
| `POST /api/refresh/:target` | Dispatches a GitHub Actions refresh (`all`, `sources`, `mail`, `knowledge`, or one specific source) |
| `POST /api/sync/:source`, `POST /api/knowledge/sync/:source`, `POST /api/mail/sync/:provider` | The underlying sync/knowledge/mailbox execution, called by the GitHub Actions job's environment — also directly callable for local `wrangler dev` testing |
| `POST /api/ai/suggest/:projectId` | Five ranked topic suggestions for a project |
| `POST /api/ai/search` | Free-text search across the knowledge base |
| `POST /api/ai/draft` | Generates the email draft, grounded in whichever knowledge documents were selected |
| `POST /api/send/log` | Logs the optimistic "sent via app" row when a compose window opens |
| `POST /api/oauth/google/connect` | Stores a Google Drive+Gmail refresh token after the browser-side OAuth round trip |
| `POST /api/oauth/microsoft/start`, `GET /api/oauth/microsoft/callback` | The Worker-owned Outlook/OneDrive OAuth flow (not through Supabase Auth) |

## Database (Supabase / Postgres)

Every table, view, function, and RLS policy is defined across the 15
migration files in `supabase/migrations/`, run in order — there is no
migration-runner tool in use; each file is pasted into the Supabase
Dashboard's SQL Editor by hand. See
[05-DATABASE-SCHEMA-AND-MIGRATIONS.md](05-DATABASE-SCHEMA-AND-MIGRATIONS.md)
for the full list and what each one does.

Core tables: `accounts`, `projects`, `people`, `project_people`,
`account_people` (legacy, pre-project-hierarchy), `roles`,
`communication_events`, `tasks` / `task_items`, `knowledge_documents`,
`user_oauth_tokens`, `sync_runs` / `source_sync_state`, `users`,
`ai_generations`, `account_source_links`.

## What is deliberately NOT built

- No server-rendering, no API routes inside Next.js itself — everything
  server-side lives in the one Cloudflare Worker file.
- No queueing system for syncs — GitHub Actions' own concurrency group
  (`comms-tracker-refresh`) ensures only one refresh runs at a time.
- No email is ever sent by the app itself — see the product requirements
  doc, §2.7.
