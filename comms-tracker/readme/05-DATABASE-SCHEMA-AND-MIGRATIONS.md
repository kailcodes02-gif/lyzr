# Database Schema and Migrations

There is no migration-runner tool in use. Every file in
`supabase/migrations/` is meant to be opened and pasted into the Supabase
Dashboard's SQL Editor (Dashboard → SQL Editor → New Query) **in numeric
order, one at a time**, on a fresh project. They are idempotent where
practical (`IF NOT EXISTS` etc.) but have not been tested for being
re-run out of order.

## Status on the outgoing (current) Supabase project, as of this handover

So you know what data already exists if you get access to the old
project rather than starting fresh: migrations **001 through 010** are
applied and have real synced data behind them (54 accounts, ~130
projects, 26,000+ communication events, ~2,100 knowledge documents at
last count). **Migrations 011 through 015 are written but not yet applied**
— they were finished in this same handover session. If you end up
inheriting the *existing* Supabase project rather than creating a fresh
one, run 011–015 there before relying on their features (full email
bodies, ranked knowledge search, the mislabeling-prevention trigger, and
the project-scoped visibility restriction — the last of which materially
changes what non-admin users can see, so treat it as a real change to
roll out deliberately, not a routine schema update).

## Every migration, in order

| # | File | What it does |
|---|---|---|
| 001 | `001_initial_schema.sql` | Core schema: `users`, `people`, `accounts`, `account_source_links`, `account_people`, `instantly_campaigns`, `communication_events`, `tasks`/`task_items`, `sync_runs`, `source_sync_state`, all the enum types, the `account_month_coverage` view, and the baseline permissive RLS (any signed-in user can read everything). |
| 002 | `002_dashboard_views.sql` | The `account_last_contact` view (last contact date + email count per account), used by the main tracker list. |
| 003 | `003_deal_owner_role.sql` | Adds `deal_owner` as a distinct relationship role, separate from Cortex's `internal_owner`, so an account can show both a Product Owner and a Deal Owner. |
| 004 | `004_account_product_links.sql` | Adds `product_links` (JSON) to `accounts`, from Cortex's per-project `appLink`. |
| 005 | `005_admin_roles.sql` | Introduces the admin role system: specific emails get `role='admin'` on first sign-in; only admins can change roles; task deletion restricted to creator-or-admin. |
| 006 | `006_projects_and_roles.sql` | The big one: Account → Projects → Stakeholders hierarchy (`projects`, `project_people`), the admin-configurable `roles` table (seeded with Product/Deal/Project Owner), `project_last_contact` / `project_staleness` / `account_people_rollup` views, and `communication_events.project_id`. |
| 007 | `007_knowledge_base.sql` | `knowledge_documents` table and the `knowledge_source_type` enum (blog, case study, Slack, Drive, meeting notes, internal email) plus `ai_generations` for tracking Sonnet usage. |
| 008 | `008_user_oauth_tokens.sql` | `user_oauth_tokens` — one row per (user, provider) holding a refresh token, for Drive's per-user consent flow. Later repurposed (009) to also hold Gmail and Outlook mail tokens. |
| 009 | `009_mailbox_sync.sql` | Mailbox reading support: `gmail`/`outlook` added to the relevant enums, `user_oauth_tokens` gains `account_email`/`mail_cursor`/`mail_synced_at`, `communication_events` gains `mailbox_user_id`/`confirmed_at`, and the Google provider row is renamed from `google_drive` to `google` (one consent now covers Drive + Gmail). |
| 010 | `010_onedrive_sharepoint.sql` | Adds the `onedrive` knowledge source type and a per-drive Graph delta-link cursor column, for reading OneDrive/SharePoint through the same Microsoft connection as Outlook mail. |
| 011 | `011_email_body_text.sql` | Adds `communication_events.body_text` — the full plain-text email body, so the double-click "read the full email" dialog shows more than a 400-character preview. **Not yet applied on the outgoing project.** |
| 012 | `012_knowledge_search.sql` | A generated `tsvector` column + GIN index + `search_knowledge()` ranked-search function over `knowledge_documents`, for the "type your own topic" search box in Generate & Send. The app works without this (falls back to a slower client-ranked full-text query) but is noticeably faster with it. **Not yet applied.** |
| 013 | `013_enforce_internal_person_type.sql` | A database trigger that forces `person_type` to `lyzr_internal` for any `@lyzr.ai`/`@lyzr.com` email, no matter what code path writes the row — a hard backstop on top of the application-level fix in `lib/sync/people.ts`, closing a mislabeling risk found and fixed 2026-09-09 (see the product requirements doc, §2.3). **Not yet applied.** |
| 014 | `014_project_scoped_visibility.sql` | Restricts non-admin visibility (via RLS) to only the accounts/projects a user is an internal stakeholder on. Adds helper functions `is_admin()`, `current_person_ids()`, `visible_project_ids()`, `visible_account_ids()`, replaces the permissive `USING (true)` read policies on `accounts`/`projects`/`project_people`/`account_people`/`communication_events`/`tasks`/`task_items`, and sets `security_invoker = on` on all five dashboard views (without this, the views would silently bypass the new RLS entirely — see the migration's own comments for why). **Not yet applied — this is a real behavior change for non-admin users, apply it deliberately.** |
| 015 | `015_add_admins.sql` | Grants admin to three more addresses on top of the existing three. **Not yet applied.** |

## Things worth knowing before you touch the schema further

- **RLS is the actual security boundary.** The frontend has no server
  layer to fall back on — every table's Row Level Security policy is what
  actually decides who can read or write what. If you add a new table,
  it needs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and an explicit
  policy, or it will default to no access at all for the anon/authenticated
  roles (safe-by-default, but easy to forget and then wonder why a new
  feature returns empty results).
- **Views bypass RLS by default in Postgres** unless created (or altered)
  with `security_invoker = on`. Migration 014 fixes this for the five
  existing views; any new view you add needs the same treatment if it
  reads from an RLS-protected table and needs to respect per-user
  visibility.
- **No down-migrations exist.** Every migration is additive/forward-only.
  If you need to reverse one, write the reversal by hand.
- **`account_people` is legacy.** It predates the Account → Projects →
  Stakeholders redesign (migration 006) and is still written to for
  HubSpot's account-level client contacts and a handful of pre-redesign
  internal-owner rows, but new internal-ownership data goes through
  `project_people` instead. Don't be surprised that both exist — they're
  not duplicates of the same concept, `account_people` is account-scoped
  and `project_people` is project-scoped.
