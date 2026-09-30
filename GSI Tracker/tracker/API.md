# Lyzr Marketing Tracker — REST API (v1)

Read and change everything in the tracker from other tools: Lyzr agents, Slack bots, scripts, reports.

- **Base URL:** `https://lyzr.kailash-gm.com/api/v1`
- **Spec:** `GET /api/v1/openapi.json` (OpenAPI 3.1 — import into Postman, an agent builder or a GPT action)
- **Code:** `functions/api/v1/[[path]].js` (Cloudflare Pages Function) · spec in `functions/api/v1/_openapi.js`
- **Keys table:** migration `supabase/migrations/029_api_keys.sql`

## Authentication

Every request (except `/` and `/openapi.json`) needs an API key:

```
Authorization: Bearer lzt_…
```

Admins create keys in **Workspace settings › Integrations › API keys**. The key is shown once; only its
SHA-256 hash is stored. A key **acts as the admin who created it**: the function signs a two-minute
Supabase token for that person, so row-level security, triggers and History behave exactly as they do in
the dashboard, and every change is logged under their name. A key stops working when it is revoked or
when its owner stops being an admin.

- **Read** keys: `GET` only.
- **Read & write** keys: also `POST`, `PATCH`, `DELETE` — except **deleting a task**, which needs a key created with
  **Can delete tasks** switched on. Without it, set `status: "cancelled"` instead.
- Keys **expire** after the period chosen when they're made (30 days, 90 days, 1 year or never).

## Safety rails (migration 030)

- **Rate limit:** 60 requests a minute per key. The 61st gets `429 rate_limited` with a `Retry-After` header
  (seconds). One busy key never slows another, and a runaway script can't swamp the database.
- **Activity log:** every accepted request (key, method, path, result, time) is recorded, kept 90 days, and shown
  to admins under Integrations › "Show recent API activity". Refused keys and rate-limited calls aren't logged.
- **The JWT secret** lives only in GitHub and Cloudflare's encrypted secrets. Never paste it into code, chat or
  docs. If it ever leaks: Supabase › JWT Keys › generate a new secret, update the GitHub secret, redeploy
  (everyone signs in again once).
- **Switching the API off:** revoke the key (instant), or remove `SUPABASE_JWT_SECRET` from Cloudflare Pages
  (the whole API returns 503). The dashboard is unaffected either way.

## Conventions

- JSON in and out. Success: `{ "data": … }`. Error: `{ "error": { "code", "message" } }`.
- Dates `YYYY-MM-DD`. Priority `critical | high | medium | low | backlog` (P0–P4 also accepted).
- Status `not_started | in_progress | live | blocked | done | cancelled`.
- `vertical` accepts a slug (`gsi`), name or id. Omitting it means every vertical — the Lyzr board.
- A task with no channel has `"channel": null` (it lives in its vertical's "No channel").

| Status | Code | Meaning |
|---|---|---|
| 400 | `bad_request` | Missing or invalid field — the message says which |
| 401 | `unauthorized` | No key, unknown key, or revoked |
| 403 | `read_only_key` / `delete_not_allowed` / `forbidden` | Read key tried to write / key can't delete tasks / the key's owner isn't allowed |
| 404 | `not_found` | No such task, channel, vertical or route |
| 409 | `blocked` | Marking done while it depends on unfinished tasks (add `?force=true`) |
| 415 | `bad_request` | Body isn't JSON |
| 429 | `rate_limited` | More than 60 requests in a minute — wait `Retry-After` seconds |
| 503 | `not_configured` | The server's `SUPABASE_JWT_SECRET` isn't set, or migration 030 is missing |

## Endpoints

### Dashboards
| | |
|---|---|
| `GET /summary?vertical=` | All Tasks tiles: total, done, not done, live, blocked, overdue, critical open, % done |
| `GET /weekly?from=&to=&vertical=` | Weekly review: planned, done, not done, cancelled, overdue carried in (default: this week) |
| `GET /history?vertical=&task=&since=&limit=` | Every logged change, newest first — includes deleted tasks |

### Structure
| | |
|---|---|
| `GET /me` | Who the key acts as, and its scope |
| `GET /verticals` | Verticals (Lyzr is `primary`) |
| `GET /channels?vertical=` | Channels + sub-channels with owners |
| `GET /domains` | Domains with owners and the channels they cover |
| `GET /people` | Everyone and their roles |
| `GET /campaigns` | Campaigns with leads, audience and task progress |

### Tasks
| | |
|---|---|
| `GET /tasks` | List. Filters: `vertical`, `channel`, `status`, `priority`, `owner`, `due_from`, `due_to`, `overdue=true`, `q`, `campaign`, `parent`, `top_level=false`, `include_cancelled=true`; `sort` = `due_date` (default) / `created_at` / `updated_at` / `priority`; `limit` (≤500) / `offset`. Returns `total` for paging. |
| `POST /tasks` | Create. `title` required; optional `description`, `channel_id` (omit → the vertical's "No channel"), `vertical` (default `lyzr`), `parent_task_id`, `owners` (emails, first is main owner; default: the key's owner), `due_date`, `priority`, `campaign_id`, `budget`, `plan` |
| `GET /tasks/{id}` | One task with sub-tasks, checklist, comments, dependencies and its history |
| `PATCH /tasks/{id}` | Update any of `title`, `description`, `status`, `priority`, `due_date`, `channel_id`, `campaign_id`, `budget`, `blocked_reason`, `plan`, `results` (plan/results are merged). `?force=true` closes despite open dependencies. |
| `DELETE /tasks/{id}` | Delete (with its sub-tasks). History keeps a record. Needs "Can delete tasks". |
| `POST /tasks/{id}/subtasks` | Add a sub-task (same body as create; inherits the channel) |
| `POST /tasks/{id}/comments` | `{ "text" }` |
| `POST /tasks/{id}/checklist` · `PATCH`/`DELETE …/checklist/{itemId}` | `{ "text", "done" }` |
| `POST /tasks/{id}/owners` · `DELETE …/owners/{email}` | `{ "email", "role" }` — people not signed in yet attach on first sign-in |
| `POST /tasks/{id}/dependencies` · `DELETE …/dependencies/{dependsOnId}` | `{ "depends_on_task_id" }` |

## Examples

```bash
KEY=lzt_…; API=https://lyzr.kailash-gm.com/api/v1

# Everything overdue in GSI
curl -H "Authorization: Bearer $KEY" "$API/tasks?vertical=gsi&overdue=true"

# Create a task in a channel with two owners
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"title":"Hyderabad roadshow","channel_id":"<channel id>","owners":["priya.sharma@lyzr.com","rahul.verma@lyzr.com"],"due_date":"2026-11-12","priority":"high"}' \
  "$API/tasks"

# Mark it live and record a result
curl -X PATCH -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"status":"live","results":{"kpi_actual":"180 attendees"}}' "$API/tasks/<task id>"

# This week's numbers
curl -H "Authorization: Bearer $KEY" "$API/summary"
```

## Setup (one time)

1. Paste `supabase/migrations/029_api_keys.sql`, then `030_api_hardening.sql`, into the Supabase SQL Editor.
2. Copy the JWT secret from Supabase › Project Settings › API (**JWT Secret**, legacy HS256) and add it as the GitHub
   repo secret **`SUPABASE_JWT_SECRET`**. The deploy workflow copies it to Cloudflare Pages on the next push
   (or set it directly: Cloudflare › Pages › lyzr-work-os › Settings › Variables and Secrets).
3. Create a key in Workspace settings › Integrations.

## Differences from the dashboard

- Marking a **recurring** task done through the API does not create its next occurrence (the dashboard does).
- Supabase's free plan has no restorable backups; History keeps deleted tasks' records, but not full copies.
