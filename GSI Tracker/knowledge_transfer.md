# Knowledge Transfer Document — Lyzr GSI/SI Marketing Tracker

This document provides a comprehensive handover for the Next.js marketing tracker application, including PRD alignment, features built, code structure, database migrations, and parked roadmap items. Use this file as a context prompt to feed into Claude or other LLMs to instantly resume development.

---

## 1. Project Context & Architecture

- **Stack**: Next.js 16.2 (App Router), React, TailwindCSS v4 (using CSS variables in `globals.css` rather than a `tailwind.config.js` file), Supabase (Auth & Database), and TanStack Query (`@tanstack/react-query`) for client-side data state.
- **Database mutations**: Handled exclusively via Next.js Server Actions (in `lib/actions/index.ts`) checking administrative credentials.
- **Data queries**: Handled on the client side using Supabase JS client and query hooks (in `lib/hooks/use-data.ts`).
- **Timezones**: Stored as UTC in Postgres and formatted in Asia/Kolkata (IST) on the frontend.

---

## 2. Features Implemented & PRD Alignment

### Phase 2 Features
1. **Interactive Calendar View** (`/calendar`): Month/week grid that visualizes tasks and lets users filter by category, channel, and owner. Includes deep-linking cross-navigation from Dashboard, Categories, and Channel detail headers.
2. **Task Dependencies & Blockers**:
   - Renders successor ("blocks") and predecessor ("depends on") tasks as clickable items inside the task details drawer.
   - Displays an warning/alert banner if a task has active, incomplete dependencies.
   - Prevents marking tasks as `done` if their blocker dependencies are incomplete (shows warning dialog).
3. **45-day Grace Period Metrics Lock**:
   - Disables all tracker metric inputs for tasks completed/live more than 45 days ago.
   - Provides an **Admin Override** toggle inside the drawer allowing administrators to edit locked inputs.
4. **Weekly Snapshot Cron API** (`/api/cron/weekly-snapshot`):
   - Daily cron endpoint secured with `CRON_SECRET` that aggregates status workloads, owner bandwidths, and remaining budgets.
   - Logs summaries and writes to a database queue for notifications.

### Phase 3 Features
1. **HubSpot OAuth Read-Only Sync**:
   - Redirect URL endpoint (`/api/auth/hubspot`) and OAuth callback exchange handler (`/api/auth/hubspot/callback`).
   - Symmetrically encrypts tokens using AES-256-GCM (requiring `ENCRYPTION_SECRET` to be exactly 32 characters in `.env.local`) before saving to `hubspot_connection`.
   - Periodic sync endpoint (`/api/cron/hubspot-sync`) that retrieves CRM contacts, কোম্পানির (company) fields, lifecycle stages, and mock sequence memberships, writing them to `hubspot_synced_contacts`.
2. **HubSpot Synced Contacts Grid**:
   - Embeds a read-only table in the **Outbound > HubSpot** channel page under a new "Synced Contacts" tab.
   - Features active sequence enrollment badges and a **Create Task** button next to each contact.
   - Clicking **Create Task** launches the task dialog pre-populated with lead names and follow-up descriptions.
3. **Notion-Style Custom Fields Engine**:
   - Dynamically loads schema specifications from the `channel_fields` table instead of hardcoded lists.
   - Resolves recursive parent cascading rules (`cascades_to_children = true`) where child channels inherit parent fields, allowing child configurations to override parent rules when slugs match.
   - Renders all 14 field types: Text, Long Text, Number, Currency (with prefix `$`), Date, Date Range (start/end ranges), Dropdown, Multi-Select tags, Checkbox, URL, Email, Phone, Person link (platform users dropdown), and File Attachment.
   - Calculates auto-calc fields (e.g. CTR, CPC, CPM, engagement rate) based on their slugs.

### Extra Administrator Features (Category & Channel Editor)
- Implemented a **Taxonomy Manager** tab under `/admin`.
- Allows administrators to create/update categories (with icon selection) and create/update/nest channels under categories (supporting sub-channels).
- Supports toggling category/channel `is_active` status to cleanly hide/show them in sidebars and dropdowns without corrupting existing task histories.

---

## 3. Database Schema Layout

The database includes the following key tables:

- **`categories`**: `id`, `name`, `slug`, `icon`, `sort_order`, `is_active`, `created_at`
- **`channels`**: `id`, `category_id`, `parent_channel_id` (for nesting), `name`, `slug`, `sort_order`, `is_active`, `created_at`
- **`channel_fields`**: `id`, `channel_id` (owner), `name`, `slug`, `field_type`, `surface` (planning/tracker), `is_required`, `options` (jsonb array), `formula`, `is_auto_calc`, `description`, `sort_order`, `cascades_to_children`, `created_at`
- **`hubspot_connection`**: `id`, `portal_id`, `access_token_encrypted`, `refresh_token_encrypted`, `expires_at`, `connected_by`, `connected_at`, `last_sync_at`
- **`hubspot_synced_contacts`**: `hubspot_contact_id`, `email`, `first_name`, `last_name`, `company`, `lifecycle_stage`, `sequence_memberships` (jsonb array), `raw_properties` (jsonb), `synced_at`

---

## 4. Environment Variables Required (`.env.local`)

Ensure the local file has:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
HUBSPOT_CLIENT_ID=your_hubspot_app_client_id
HUBSPOT_CLIENT_SECRET=your_hubspot_app_client_secret
ENCRYPTION_SECRET=32_character_hex_or_string_key
CRON_SECRET=arbitrary_secret_token_for_cron
```

---

## 5. Parked Backlog / Future Roadmap Items

1. **Slack Notification Dispatcher**: We created stubs and the queue table `pending_slack_notifications`, but the active Slack Webhook integration and OAuth bot dispatcher are parked.
2. **CSV Column-Mapping UI**: Let users map arbitrary CSV columns to leads on import instead of a fixed schema.
3. **HubSpot Pipeline Deal Value Pull**: Auto-pull deal values (`pipeline_influenced_usd`) instead of entering them manually in tracker fields.
4. **Generic Formula Calculation Engine**: Let admins write custom math parsing strings in the database rather than resolving specific auto-calc slugs.
