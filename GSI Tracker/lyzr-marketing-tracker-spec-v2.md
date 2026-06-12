# Lyzr GSI/SI Marketing Tracker — Build Specification v2

> Internal task, tracker, and budget tool for the Lyzr GSI/SI business unit marketing team. Paste this entire document into Antigravity (or Claude Code) as the kickoff brief.

---

## 0. How to read this document

This is a complete brief. Sections 1–4 are context and stack. Section 5 is the full data model. Sections 6–13 are feature specs. Section 14 is the sprint plan. Section 15 is the v2 backlog. Section 16 is open items needing the user's input before final kickoff.

If anything in §6–13 contradicts §5, the data model wins — flag the conflict.

---

## 1. Purpose

Replace scattered task tracking (Asana / spreadsheets / Slack) for Lyzr's GSI/SI business unit marketing team. The tool models the actual marketing taxonomy (Category → Channel → Sub-channel → Task → Subtask → Checklist), separates **forward-looking task planning** from **backward-looking performance tracking**, manages **monthly budgets at any taxonomy level**, and surfaces a **weekly historical view** of what shipped. Slack-native notifications. HubSpot read-only sync.

**Not** multi-tenant. Not public. ~10–50 users, all `@lyzr.ai`. One business unit (GSI/SI).

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router), TypeScript, Server Actions |
| Styling | Tailwind + shadcn/ui |
| DB | Supabase Postgres with RLS |
| Auth | Supabase Auth — Google SSO, domain-restricted to `@lyzr.ai` |
| Storage | Supabase Storage (`task-results` bucket, 2MB file limit) |
| Realtime | Supabase Realtime (notifications, task updates) |
| Client cache | TanStack Query |
| Drag-drop | @dnd-kit/core |
| Calendar | react-big-calendar |
| Forms | react-hook-form + zod |
| CSV parsing | papaparse |
| Date utils | date-fns (with date-fns-tz for IST handling) |
| Slack | @slack/web-api |
| HubSpot | @hubspot/api-client |
| Toasts | sonner |
| Deploy | Vercel |

**Hard timezone**: Asia/Kolkata (IST, UTC+5:30). All dates displayed in IST. DB stores UTC. No user-level timezone overrides.

---

## 3. Users & auth

- **Google SSO only**, domain-restricted to `@lyzr.ai`. First name and avatar pulled from Google profile on first sign-in.
- **No separate signup flow.** Users come into existence the first time they SSO.
- **One admin** seeded at first run: `kailash.gm@lyzr.ai`.
- **Roles**: `admin` | `member`. No channel admins, no per-category roles.
- **Mention-by-email resolution**: when a user is `@`-tagged with an email address that doesn't yet exist in `users`, store the mention as a pending email. The first time that email signs in via Google SSO, retroactively resolve all pending mentions to the new `user_id`.

```sql
create type user_role as enum ('admin', 'member');

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text,
  avatar_url text,
  role user_role not null default 'member',
  slack_user_id text,
  created_at timestamptz not null default now()
);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, display_name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    case when new.email = 'kailash.gm@lyzr.ai' then 'admin'::user_role else 'member'::user_role end
  );
  -- Resolve any pending mentions for this email
  update pending_mentions set resolved_user_id = new.id, resolved_at = now()
    where email = new.email and resolved_user_id is null;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();
```

---

## 4. Two-surface architecture: Task Board vs Tracker

This is the most important conceptual split in the tool. Get this right and everything else follows.

**Task Board** — forward-looking.
- Holds tasks that are `not_started`, `in_progress`, `live`, or `blocked`.
- Fields filled in here are **planning fields**: title, description, owners, due date, priority, budget allocated, dependencies, channel-specific planning custom fields.
- Each channel defines its own planning custom fields.

**Tracker** — backward-looking.
- Holds tasks that are `live`, `done`, or `cancelled`. (`live` appears in BOTH surfaces because it's an active task accruing real-world metrics.)
- Fields filled in here are **tracker fields**: post-campaign metrics — impressions, opens, conversions, spend actuals — plus a universal **Insights** field for learnings.
- Each channel defines its own tracker custom fields.
- Tracker fields are **editable for 45 days after `completed_at`** (or `went_live_at` if applicable), then frozen.
- Auto-calculated fields (open rate, CTR, CPC, etc.) are read-only.
- Cancelled tasks appear in Tracker too, with all metric fields blank — the Insights field captures "why we killed it."

The same task moves from Board to Tracker by status transition. No data duplication; just different field visibility per status.

---

## 5. Data model

### 5.1 Taxonomy: Categories and Channels

```sql
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  icon text,                          -- lucide icon name
  sort_order int not null default 0,
  is_active bool not null default true,
  created_at timestamptz not null default now()
);

create table channels (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete restrict,
  parent_channel_id uuid references channels(id) on delete restrict,
  name text not null,
  slug text not null,
  sort_order int not null default 0,
  is_active bool not null default true,
  created_at timestamptz not null default now(),
  unique (category_id, parent_channel_id, slug)
);

create index channels_category_idx on channels(category_id);
create index channels_parent_idx on channels(parent_channel_id);
```

### 5.2 Custom field schemas (the Notion-style engine)

Custom fields are defined **per channel** (not per task type) and **cascade to all sub-channels**. A child channel can add additional fields but cannot remove inherited ones (it can mark them hidden in its own UI configuration).

```sql
create type field_type as enum (
  'text', 'long_text', 'number', 'currency',
  'date', 'date_range',
  'dropdown', 'multi_select', 'checkbox',
  'url', 'email', 'phone',
  'person', 'file'
);

create type field_surface as enum ('planning', 'tracker');

create table channel_fields (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  name text not null,
  slug text not null,
  field_type field_type not null,
  surface field_surface not null,         -- planning OR tracker
  is_required bool not null default false,
  options jsonb,                          -- for dropdown/multi_select: ["opt1","opt2",...]
  formula text,                           -- for auto-calc tracker fields, e.g. "opens / sends * 100"
  is_auto_calc bool not null default false,
  description text,
  sort_order int not null default 0,
  cascades_to_children bool not null default true,
  created_at timestamptz not null default now(),
  unique (channel_id, slug)
);

create index channel_fields_channel_idx on channel_fields(channel_id);
create index channel_fields_surface_idx on channel_fields(surface);
```

Field values are stored on tasks as JSONB, keyed by `field_slug`:

```jsonb
-- on tasks.planning_fields
{ "ad_account": "Lyzr-NY-1", "launch_date": "2026-06-01", "budget_per_lead": 50 }

-- on tasks.tracker_fields
{ "impressions": 45000, "clicks": 320, "ctr": 0.71, "insights": [
  { "n": 1, "body": "Conversation ads outperformed awareness 3x on CPL", "added_at": "...", "added_by": "..." }
]}
```

### 5.3 Tasks (the core)

```sql
create type task_status as enum ('not_started', 'in_progress', 'live', 'blocked', 'done', 'cancelled');
create type task_priority as enum ('P0', 'P1', 'P2', 'P3');
create type assignment_role as enum ('primary', 'secondary', 'tertiary', 'other');

create table tasks (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete restrict,
  parent_task_id uuid references tasks(id) on delete cascade,  -- for subtask hierarchy
  nesting_level int not null default 0,                        -- 0=L1 parent, 1=L2 subtask, 2=L3 sub-sub
  title text not null,
  description text,
  priority task_priority not null default 'P2',
  status task_status not null default 'not_started',
  due_date date,
  result_url text,
  result_file_path text,
  budget_allocated numeric(12,2),
  budget_period_id uuid references budget_periods(id),
  blocked_by_user_id uuid references users(id),
  blocked_by_email text,
  blocked_reason text,
  planning_fields jsonb not null default '{}'::jsonb,
  tracker_fields jsonb not null default '{}'::jsonb,
  recurring_template_id uuid references recurring_templates(id),
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  went_live_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  tracker_frozen_at timestamptz,        -- set to completed_at/went_live_at + 45 days
  check (nesting_level >= 0 and nesting_level <= 2)
);

create index tasks_channel_idx on tasks(channel_id);
create index tasks_parent_idx on tasks(parent_task_id);
create index tasks_status_idx on tasks(status);
create index tasks_due_date_idx on tasks(due_date);
create index tasks_created_by_idx on tasks(created_by);
create index tasks_budget_period_idx on tasks(budget_period_id);
```

**Hierarchy rules:**
- Max nesting depth: 3 (L1 parent → L2 subtask → L3 sub-subtask)
- Subtask CAN live in a different channel from parent (this is the cross-category subtask feature)
- Subtask CAN go `live` or `done` independently of parent
- Parent CANNOT be marked `done` until all subtasks are `done` or `cancelled`
- Parent CANNOT be `cancelled` if any subtask is `live` (warn, require confirm)

### 5.4 Checklists (at any task level)

Lightweight items, no status complexity. Can have @mentions.

```sql
create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  body text not null,
  is_done bool not null default false,
  done_at timestamptz,
  done_by uuid references users(id),
  sort_order int not null default 0,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create index checklist_task_idx on checklist_items(task_id);
```

### 5.5 Assignments (multi-owner)

```sql
create table task_assignments (
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role assignment_role not null default 'other',
  assigned_at timestamptz not null default now(),
  assigned_by uuid references users(id),
  primary key (task_id, user_id)
);

create index task_assignments_user_idx on task_assignments(user_id);

-- Exactly one primary per task
create unique index task_assignments_primary_unique
  on task_assignments(task_id) where role = 'primary';

-- At least one owner enforced at application layer + via this CHECK:
-- A task must have ≥1 row in task_assignments. Enforced by trigger that prevents
-- deletion of the last assignment.
```

### 5.6 Mentions & implicit ownership

The unusual rule: a `@mention` of a user (in description, comments, checklist items, or blocked-by description) shows up in that user's "My Tasks" view under a separate **Mentioned** section (vs **Assigned to me**). Mention also fires a Slack DM + in-app notification.

```sql
create type mention_surface as enum (
  'task_description', 'task_comment', 'checklist_item', 'blocked_description', 'insight'
);

create table mentions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  surface mention_surface not null,
  surface_ref_id uuid,                  -- comment id, checklist item id, etc.
  mentioned_user_id uuid references users(id) on delete cascade,
  mentioned_email text,                 -- for unresolved mentions
  mentioned_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table pending_mentions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  task_id uuid not null references tasks(id) on delete cascade,
  surface mention_surface not null,
  surface_ref_id uuid,
  resolved_user_id uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index mentions_user_idx on mentions(mentioned_user_id);
create index mentions_task_idx on mentions(task_id);
```

### 5.7 Comments

```sql
create table task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete restrict,
  body text not null,
  file_path text,                       -- optional attachment, 2MB limit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index task_comments_task_idx on task_comments(task_id);
```

### 5.8 Dependencies

Both directions stored explicitly. When the "depends on" task transitions to `done`, the dependent task fires a Slack DM to its owners (but status stays manual).

```sql
create table task_dependencies (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  depends_on_task_id uuid not null references tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

create index task_deps_task_idx on task_dependencies(task_id);
create index task_deps_depends_on_idx on task_dependencies(depends_on_task_id);
```

### 5.9 Recurring tasks (simple Google Calendar model)

```sql
create type recurrence_pattern as enum (
  'daily', 'weekly', 'biweekly', 'monthly', 'custom'
);

create table recurring_templates (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete restrict,
  title text not null,
  description text,
  default_priority task_priority not null default 'P2',
  default_planning_fields jsonb not null default '{}'::jsonb,
  pattern recurrence_pattern not null,
  custom_interval_days int,             -- for 'custom' pattern
  starts_on date not null,
  ends_on date,                         -- null = no end
  next_due_date date not null,          -- next instance to generate
  default_assignees uuid[] not null default '{}',   -- user ids
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  is_active bool not null default true
);

create index recurring_templates_next_due_idx on recurring_templates(next_due_date)
  where is_active = true;
```

**Behavior**: When a task generated from a template is marked `done`, the next instance auto-generates with `due_date = template.next_due_date`, and the template's `next_due_date` advances by the pattern interval. Editing a generated instance edits only that instance. Editing the template affects future instances only.

### 5.10 Budgets

```sql
create type budget_period_type as enum (
  'one_time', 'monthly', 'quarterly', 'half_yearly', 'annual', 'custom'
);

create type budget_scope_type as enum (
  'global', 'category', 'channel'        -- 'global' = GSI/SI top-level
);

create table budget_periods (
  id uuid primary key default gen_random_uuid(),
  scope_type budget_scope_type not null,
  scope_id uuid,                         -- category_id or channel_id; null for 'global'
  period_type budget_period_type not null,
  period_label text not null,            -- "May 2026", "Q2 2026", "H1 2026", "2026", "Custom: Apr 15 – May 15"
  starts_on date not null,
  ends_on date not null,
  total_budget numeric(12,2) not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  notes text,
  check (ends_on >= starts_on)
);

create index budget_periods_scope_idx on budget_periods(scope_type, scope_id);
create index budget_periods_dates_idx on budget_periods(starts_on, ends_on);
```

**Rules:**
- Only admin creates `budget_periods`.
- A task allocates from one `budget_period_id` (the bucket it's drawing from).
- Allocation rights: task creator can attach budget to their task.
- Over-allocation: **warn but allow** (UI shows the bucket as over-budget in red).
- No rollover: unused budget from a past period is flagged in the Tracker as "unspent" but does not roll forward.
- All currency in **USD**. No multi-currency support.
- Track **allocated only**, not actual spend (v2).

**Bucket math** (computed view, not stored):

```sql
create view budget_period_summary as
select
  bp.id as budget_period_id,
  bp.period_label,
  bp.total_budget,
  coalesce(sum(t.budget_allocated), 0) as allocated,
  bp.total_budget - coalesce(sum(t.budget_allocated), 0) as remaining,
  count(t.id) filter (where t.budget_allocated is not null) as task_count
from budget_periods bp
left join tasks t on t.budget_period_id = bp.id
group by bp.id;
```

### 5.11 Activity log + weekly snapshots

```sql
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  action text not null,
  from_value jsonb,
  to_value jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_task_idx on activity_log(task_id);
create index activity_log_created_idx on activity_log(created_at desc);

create table weekly_snapshots (
  id uuid primary key default gen_random_uuid(),
  week_starting date not null unique,
  total_tasks int not null,
  completed_tasks int not null,
  blocked_tasks int not null,
  live_tasks int not null,
  in_progress_tasks int not null,
  not_started_tasks int not null,
  cancelled_tasks int not null,
  by_category jsonb not null,
  by_owner jsonb not null,
  budget_summary jsonb not null,
  created_at timestamptz not null default now()
);
```

Triggers on `tasks`, `task_assignments`, `checklist_items`, `task_comments` write to `activity_log`. A nightly Supabase Edge Function writes `weekly_snapshots` (run at 23:55 IST every Sunday for the just-completed ISO week).

### 5.12 Notifications

```sql
create type notification_type as enum (
  'assigned', 'mentioned', 'comment',
  'status_change', 'dependency_completed',
  'subtask_completed', 'parent_blocked',
  'budget_overrun_warning', 'overdue'
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  type notification_type not null,
  payload jsonb not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on notifications(user_id) where read_at is null;

-- Queue for Slack dispatch
create table pending_slack_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications(id) on delete cascade,
  slack_payload jsonb not null,
  attempt_count int not null default 0,
  dispatched_at timestamptz,
  error_text text,
  created_at timestamptz not null default now()
);
```

### 5.13 Integration settings

```sql
create table slack_settings (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id) on delete cascade,   -- null = default
  slack_channel_id text not null,
  notify_on_create bool not null default true,
  notify_on_complete bool not null default true,
  notify_on_blocked bool not null default true,
  notify_on_live bool not null default true,
  notify_on_overdue bool not null default true,
  updated_at timestamptz not null default now()
);

create table hubspot_connection (
  id uuid primary key default gen_random_uuid(),
  portal_id text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  expires_at timestamptz not null,
  connected_by uuid not null references users(id),
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz
);

create table hubspot_synced_contacts (
  hubspot_contact_id text primary key,
  email text not null,
  first_name text,
  last_name text,
  company text,
  lifecycle_stage text,
  sequence_memberships jsonb,            -- which sequences they're enrolled in
  raw_properties jsonb,
  synced_at timestamptz not null default now()
);
```

---

## 6. Row-Level Security (RLS)

Enable RLS on every table. Pattern summary:

| Table | Read | Insert | Update | Delete |
|---|---|---|---|---|
| `users` | any auth | system (trigger) | self + admin | admin |
| `categories` | any auth | admin | admin | admin |
| `channels` | any auth | admin | admin | admin |
| `channel_fields` | any auth | admin | admin | admin |
| `tasks` | any auth | any auth | any auth (per §6.1) | creator + admin |
| `task_assignments` | any auth | any auth | any auth | any auth |
| `checklist_items` | any auth | any auth | any auth | any auth |
| `task_comments` | any auth | any auth | author + admin | author + admin |
| `mentions` | any auth | system (trigger) | none | none |
| `task_dependencies` | any auth | any auth | none | any auth |
| `recurring_templates` | any auth | any auth | creator + admin | creator + admin |
| `budget_periods` | any auth | admin | admin | admin |
| `activity_log` | any auth | system | none | none |
| `weekly_snapshots` | any auth | system | none | none |
| `notifications` | self + admin | system | self (mark read) | none |
| `slack_settings` | admin | admin | admin | admin |
| `hubspot_*` | admin | admin | admin | admin |
| `hubspot_synced_contacts` | any auth | system | system | system |

### 6.1 Task update nuance

Any authenticated user can update most fields. BUT:
- `tracker_fields` are read-only after `tracker_frozen_at` (45 days post-completion). Admin override allowed.
- `created_by` is immutable.
- Auto-calc fields are read-only always.
- Cascading rule: cannot mark parent `done` while subtasks exist that aren't `done` or `cancelled` (enforced via trigger).

Sample policy:

```sql
alter table tasks enable row level security;

create policy "tasks_read_all" on tasks
  for select to authenticated using (true);

create policy "tasks_insert_self" on tasks
  for insert to authenticated
  with check (auth.uid() = created_by);

create policy "tasks_update_any_auth" on tasks
  for update to authenticated
  using (true)
  with check (
    -- Enforce tracker freeze
    (tracker_frozen_at is null or tracker_frozen_at > now())
    or exists (select 1 from users where id = auth.uid() and role = 'admin')
  );

create policy "tasks_delete_creator_or_admin" on tasks
  for delete to authenticated using (
    auth.uid() = created_by
    or exists (select 1 from users where id = auth.uid() and role = 'admin')
  );
```

---

## 7. Initial taxonomy seed

```yaml
categories:
  - name: Social
    slug: social
    icon: share-2
    channels:
      - name: LinkedIn page
        slug: linkedin-page
      - name: LinkedIn article
        slug: linkedin-article
      - name: Reddit
        slug: reddit
      - name: LinkedIn Ads
        slug: linkedin-ads
        children:
          - { name: Conversation ads, slug: conversation-ads }
          - { name: Awareness ads, slug: awareness-ads }
          - { name: Amplification ads, slug: amplification-ads }
          - { name: Lead gen ads, slug: lead-gen-ads }

  - name: Content
    slug: content
    icon: file-text
    channels:
      - { name: Case study, slug: case-study }
      - { name: Blogs, slug: blogs }
      - { name: Newsletter, slug: newsletter }
      - { name: White paper, slug: white-paper }
      - { name: Playbooks, slug: playbooks }

  - name: Events
    slug: events
    icon: calendar
    channels:
      - { name: Panels, slug: panels }
      - { name: Sponsor, slug: sponsor }
      - { name: Attending, slug: attending }
      - { name: Workshops, slug: workshops }
      - { name: Stalls, slug: stalls }

  - name: Co-marketing
    slug: co-marketing
    icon: handshake
    channels:
      - { name: Webinar, slug: webinar }
      - { name: Podcast, slug: podcast }
      - { name: Testimonial, slug: testimonial }

  - name: Growth Hack
    slug: growth-hack
    icon: zap
    channels:
      - { name: Survey, slug: survey }
      - { name: Spotlights, slug: spotlights }

  - name: Outbound
    slug: outbound
    icon: send
    channels:
      - { name: Instantly, slug: instantly }
      - { name: PhantomBuster, slug: phantombuster }
      - name: HubSpot
        slug: hubspot
        children:
          - name: Email sequences
            slug: email-sequences
            children:
              - { name: ICP, slug: icp }
              - { name: Non-ICP, slug: non-icp }

  - name: Leads Pipeline
    slug: leads-pipeline
    icon: users
    channels:
      - { name: All leads, slug: all-leads }
```

**Note**: Leads Pipeline is a top-level category. CSV uploads create tasks here. Each lead = a task. Lead-specific custom fields defined on the All leads channel.

---

## 8. Channel field definitions (seeded)

The Notion-style engine is generic, but we seed sensible defaults per channel. Admin can edit/add/remove via the admin panel after seed.

### Universal across all Tracker entries (added to every channel automatically)
- `insights` (long_text, numbered list semantics) — tracker surface — learnings, what worked, what didn't. Supports @mentions.
- `result_url` (url) — tracker surface
- `result_file` (file, 2MB max) — tracker surface

### Social > LinkedIn page

**Planning fields**:
- `posted_by` (text) — name of the executive whose page this is for (Anju, Siva, Vidur, etc.)
- `post_type` (dropdown: article, thought_leadership, video, text_only, reshare)

**Tracker fields**:
- `post_url` (url)
- `total_impressions` (number)
- `reactions` (number)
- `comments` (number)
- `reshares` (number)
- `engagement_rate` (number, auto-calc, formula: `(reactions + comments + reshares) / total_impressions * 100`)

### Social > LinkedIn article

**Planning fields**:
- `posted_by` (text)
- `working_title` (text)
- `target_keyword` (text)
- `word_count_target` (number)

**Tracker fields**:
- `article_url` (url)
- `word_count_actual` (number)
- `total_reads` (number)
- `reactions` (number)
- `comments` (number)
- `reshares` (number)

### Social > Reddit

**Planning fields**:
- `subreddit` (text)
- `post_type` (dropdown: original_post, comment_thread, ama)

**Tracker fields**:
- `post_url` (url)
- `upvotes` (number)
- `comments_received` (number)
- `comments_posted_by_us` (number)
- `karma_delta` (number)

### Social > LinkedIn Ads (parent — cascades to all sub-types)

**Planning fields** (cascade to all 4 ad sub-types):
- `ad_account` (text) — which LinkedIn ad account
- `launch_date` (date)
- `end_date` (date)
- `budget_per_ad` (currency)
- `budget_per_lead` (currency)
- `targeting_summary` (long_text)

**Tracker fields** (cascade to all 4 ad sub-types):
- `launch_date_actual` (date)
- `end_date_actual` (date)
- `total_spend` (currency)
- `impressions` (number)
- `clicks` (number)
- `ctr` (number, auto: `clicks / impressions * 100`)
- `cpc` (currency, auto: `total_spend / clicks`)
- `cpm` (currency, auto: `total_spend / impressions * 1000`)

### Social > LinkedIn Ads > Conversation ads (additional)

**Tracker fields**:
- `conversation_opens` (number)
- `conversation_completions` (number)
- `cta_clicks` (number)
- `cpa` (currency, auto: `total_spend / cta_clicks`)
- `tofu_count` (number) — placeholder, definition TBD by user
- `mofu_count` (number)
- `bofu_count` (number)

### Social > LinkedIn Ads > Lead gen ads (additional)

**Tracker fields**:
- `leads_generated` (number)
- `cost_per_lead_actual` (currency, auto: `total_spend / leads_generated`)

### Content > Case study

**Planning fields**:
- `customer_partner_name` (text)
- `product_featured` (multi_select: Jazon, Skott, Diane, Jeff, Dwight, Kathy, Cognis, LyzrGPT, GitAgent, Architect)
- `approval_owner_email` (email)
- `distribution_channels` (multi_select: website, linkedin, sales_enablement, partner_site)
- `word_count_target` (number)

**Tracker fields**:
- `published_url` (url)
- `publish_date` (date)
- `total_reads` (number)
- `top_traffic_source` (text)
- `sales_enablement_reuse_count` (number)

### Content > Blogs

**Planning fields**:
- `working_title` (text)
- `target_keyword` (text)
- `word_count_target` (number)
- `distribution_channels` (multi_select)
- `seo_meta_description` (long_text)

**Tracker fields**:
- `published_url` (url)
- `publish_date` (date)
- `total_reads` (number)
- `top_traffic_source` (text)
- `backlinks_earned` (number)

### Content > Newsletter

**Planning fields**:
- `issue_number` (text)
- `send_date` (date)
- `audience_segment` (dropdown: all_subscribers, icp_only, partners, investors)
- `subject_line_draft` (text)

**Tracker fields**:
- `total_sends` (number)
- `total_opens` (number)
- `open_rate` (number, auto)
- `clicks` (number)
- `unsubscribes` (number)

### Content > White paper

**Planning fields**:
- `working_title` (text)
- `theme_pillar` (text)
- `lead_author` (person)
- `co_authors` (multi_select — pulls from users)
- `word_count_target` (number)
- `is_gated` (checkbox)

**Tracker fields**:
- `published_url` (url)
- `total_downloads` (number)
- `gated_form_submissions` (number)
- `backlinks_earned` (number)

### Content > Playbooks

**Planning fields**:
- `working_title` (text)
- `audience` (text)
- `distribution_channels` (multi_select)
- `companion_assets` (long_text)

**Tracker fields**:
- `published_url` (url)
- `total_downloads` (number)
- `sales_enablement_reuse_count` (number)

### Events > Panels

**Planning fields**:
- `event_name` (text)
- `event_date` (date)
- `venue_or_virtual` (text)
- `lyzr_speaker` (person)
- `panel_topic` (text)
- `other_panelists` (long_text)

**Tracker fields**:
- `total_attendees` (number)
- `lyzr_attributable_leads` (number)
- `meetings_booked` (number)
- `pipeline_influenced_usd` (currency)  -- manual entry, see §13

### Events > Sponsor

**Planning fields**:
- `event_name` (text)
- `event_date_range` (date_range)
- `sponsorship_tier` (dropdown: title, platinum, gold, silver, bronze, custom)
- `sponsorship_cost` (currency)
- `deliverables` (long_text)

**Tracker fields**:
- `total_attendees` (number)
- `lyzr_attributable_leads` (number)
- `cost_per_lead` (currency, auto: `sponsorship_cost / lyzr_attributable_leads`)
- `meetings_booked` (number)
- `pipeline_influenced_usd` (currency)

### Events > Attending

**Planning fields**:
- `event_name` (text)
- `event_date_range` (date_range)
- `lyzr_attendees` (multi_select — pulls from users)
- `goal` (dropdown: lead_gen, networking, content_capture, partner_meetings)
- `target_meetings` (number)

**Tracker fields**:
- `meetings_held` (number)
- `lyzr_attributable_leads` (number)
- `pipeline_influenced_usd` (currency)

### Events > Workshops

**Planning fields**:
- `workshop_name` (text)
- `event_date` (date)
- `format` (dropdown: in_person, virtual, hybrid)
- `registration_target` (number)
- `venue` (text)
- `co_host_or_partner` (text)

**Tracker fields**:
- `registrations` (number)
- `attendees` (number)
- `show_up_rate` (number, auto: `attendees / registrations * 100`)
- `lyzr_attributable_leads` (number)
- `meetings_booked` (number)
- `pipeline_influenced_usd` (currency)

### Events > Stalls

**Planning fields**:
- `event_name` (text)
- `event_date_range` (date_range)
- `booth_size` (text)
- `booth_cost` (currency)
- `staff_assigned` (multi_select — pulls from users)
- `collateral_needed` (long_text)

**Tracker fields**:
- `total_visitors` (number)
- `lyzr_attributable_leads` (number)
- `cost_per_lead` (currency, auto)
- `meetings_booked` (number)
- `pipeline_influenced_usd` (currency)

### Co-marketing > Webinar

**Planning fields**:
- `type` (dropdown: hosted, attending)
- `webinar_title` (text)
- `partner_or_host` (text)
- `webinar_date` (date)
- `lyzr_speaker` (person)
- `registration_url` (url)
- `platform` (dropdown: linkedin_live, zoom, riverside, other)

**Tracker fields**:
- `recording_url` (url)
- `registrations` (number)
- `attendees` (number)
- `show_up_rate` (number, auto)
- `mqls_generated` (number)
- `replay_views` (number)
- `pipeline_influenced_usd` (currency)

### Co-marketing > Podcast

**Planning fields**:
- `type` (dropdown: hosted, attending)
- `podcast_name` (text)
- `episode_title` (text)
- `recording_date` (date)
- `publish_date` (date)
- `lyzr_guest_or_host` (person)
- `other_party` (text)

**Tracker fields**:
- `published_episode_url` (url)
- `plays_or_downloads` (number)
- `social_mentions` (number)
- `inbound_inquiries_attributed` (number)

### Co-marketing > Testimonial

**Planning fields**:
- `customer_partner_name` (text)
- `product_featured` (multi_select: same options as Case study)
- `format` (dropdown: video, written, audio)
- `length_target` (text)
- `usage_rights` (dropdown: full, marketing_only, web_only, time_limited)

**Tracker fields**:
- `final_asset_url` (url)
- `usage_placements` (long_text)

### Growth Hack > Survey

**Planning fields**:
- `target_account_or_industry` (text)
- `number_of_folks_target` (number)
- `survey_platform` (text)
- `survey_url` (url)

**Tracker fields**:
- `total_respondents` (number)
- `report_asset_url` (url)
- `distribution_reach` (number)
- `inbound_inquiries_attributed` (number)

### Growth Hack > Spotlights

**Planning fields**:
- `featured_account_or_partner` (text)
- `number_of_folks_target` (number)
- `format` (dropdown: written, video, audio)

**Tracker fields**:
- `published_url` (url)
- `distribution_reach` (number)
- `inbound_inquiries_attributed` (number)

### Outbound > Instantly

**Planning fields**:
- `email_subject_draft` (text)
- `tracking_link` (url)
- `number_of_people_target` (number)
- `total_accounts_to_send` (number)
- `expected_outcome` (long_text)
- `cta` (text)

**Tracker fields**:
- `total_sends` (number) — TOFU
- `total_opens` (number) — MOFU
- `total_engagements` (number) — MOFU
- `open_rate` (number, auto: `total_opens / total_sends * 100`)
- `engagement_rate` (number, auto: `total_engagements / total_sends * 100`)
- `total_conversions` (number) — BOFU
- `demos_booked` (number) — BOFU
- `conversion_rate` (number, auto: `total_conversions / total_sends * 100`)

### Outbound > PhantomBuster

**Planning fields**:
- `target_persona` (text)
- `number_of_people_target` (number)
- `phantombuster_phantom_name` (text)
- `expected_outcome` (long_text)
- `cta` (text)

**Tracker fields**:
- `connection_requests_sent` (number) — TOFU
- `accepted` (number) — MOFU
- `replied` (number) — MOFU
- `acceptance_rate` (number, auto: `accepted / connection_requests_sent * 100`)
- `reply_rate` (number, auto: `replied / accepted * 100`)
- `demos_booked` (number) — BOFU
- `conversion_rate` (number, auto: `demos_booked / connection_requests_sent * 100`)

### Outbound > HubSpot > Email sequences > ICP

**Planning fields**:
- `sequence_name` (text)
- `target_accounts_list_url` (url)
- `sequence_length_days` (number)
- `optimization_target` (text, default: "demos_booked")

**Tracker fields**:
- `total_sends` (number) — TOFU
- `total_opens` (number) — MOFU
- `total_engagements` (number) — MOFU
- `open_rate` (number, auto)
- `engagement_rate` (number, auto)
- `demos_booked` (number) — BOFU (optimization target)
- `demo_booking_rate` (number, auto: `demos_booked / total_sends * 100`)

### Outbound > HubSpot > Email sequences > Non-ICP

**Planning fields**:
- `sequence_name` (text)
- `target_accounts_list_url` (url)
- `sequence_length_days` (number)
- `optimization_target` (text, default: "referrals")

**Tracker fields**:
- `total_sends` (number)
- `total_opens` (number)
- `total_engagements` (number)
- `open_rate` (number, auto)
- `engagement_rate` (number, auto)
- `referrals_secured` (number) — BOFU (optimization target)
- `senior_intros_from_referrals` (number)
- `referral_rate` (number, auto: `referrals_secured / total_sends * 100`)

### Leads Pipeline > All leads

**Planning fields**:
- `name` (text)
- `email` (email)
- `company` (text)
- `source_channel` (text) — free text, references where the lead came from
- `generated_date` (date)
- `lead_status` (dropdown: new, contacted, qualified, unqualified, converted, lost)
- `notes` (long_text)

**Tracker fields**: none — leads use planning fields throughout their lifecycle.

---

## 9. Information architecture

### Sidebar (collapsible, always visible)

```
[Lyzr GSI/SI Tracker]
─────────────────────
🏠 Dashboard
📅 My Calendar
✅ My Tasks
🔔 Tracker (global)
💰 Budgets
─────────────────────
CATEGORIES
  📣 Social
  📝 Content
  🎤 Events
  🤝 Co-marketing
  ⚡ Growth Hack
  📤 Outbound
  👥 Leads Pipeline
─────────────────────
TEAM
  👤 Owners
  📊 Weekly Review
─────────────────────
[admin only]
⚙️ Admin
```

### Top bar
- Global search (cmd-K) — searches tasks only (not comments)
- `+ New task` button
- Budget summary chip (global): "$45,000 budget · $32,100 allocated · $12,900 remaining"
- Notification bell (unread count)
- User avatar dropdown

---

## 10. Views — full specification

### 10.1 Dashboard (`/`)

Single user-personalized landing page.

- **Top strip**: 4 KPI tiles
  - My open tasks (count)
  - My overdue (count, red if >0)
  - Tasks I'm mentioned in (count)
  - Global budget remaining (USD)
- **Mid section**:
  - "My day" — tasks assigned to me OR mentioning me, due today or overdue, sorted by priority then due date
  - "Going live this week" — tasks transitioning to `live` in the next 7 days
- **Recent activity** — last 20 entries from `activity_log`, real-time via Supabase subscription
- **Budget overview** — 3 budget bucket cards, top by allocation %: shows progress bars

### 10.2 Category page (`/c/[categorySlug]`)

Tabs: **Tasks** | **Calendar** | **Tracker** | **Budget**

Left sub-panel: channel tree for this category, collapsible. Click a channel = filters all tabs.

Top of page: category-level budget widget (if a budget exists for this category in current period).

#### Tab: Tasks
- View toggle: **Kanban** (5 columns: Not Started / In Progress / Live / Blocked / Done) or **Table**
- Cancelled tasks hidden by default, toggle to show
- Filters: priority, owner, due date range, has-budget, has-subtasks
- Card displays: title, priority pill, primary owner avatar, due date, budget chip (if allocated), subtask count badge
- Click card → opens detail drawer (50% width right side)

#### Tab: Calendar
- Month / week toggle
- Cards on dates show: title (truncated), priority color, primary owner avatar
- Recurring tasks shown with 🔁 icon

#### Tab: Tracker
- Only tasks with status `live`, `done`, or `cancelled` (cancelled hidden by default)
- Grouped by channel inside category, expandable
- Tracker fields displayed inline (table view) — channel-specific columns
- Auto-calc fields shown with formula tooltip
- "Frozen" badge on tasks past `tracker_frozen_at`
- Insights column always shown — click to expand the numbered insight list

#### Tab: Budget
- Bucket: current period's category-level budget
- Sortable table of all tasks in this category with budget allocated
- Sortable by: amount, allocation date, owner, status
- "Unspent from previous period" callout if applicable

### 10.3 Channel page (`/c/[categorySlug]/[channelSlug]`)

Same as Category page but scoped to one channel (recursively including sub-channels). Channel-level budget widget if set.

For nested channels (e.g., LinkedIn Ads > Conversation ads), URL: `/c/social/linkedin-ads/conversation-ads`.

### 10.4 Global Tracker (`/tracker`)

- All tracker entries across all categories
- Filters: category, channel, status (live/done/cancelled), date range
- Sort: completed date, channel, owner
- Export to CSV button
- Insights column with @mention support

### 10.5 Global Budget view (`/budgets`)

- Big strip at top: GSI/SI global budget for current month (or period selector)
  - Total / Allocated / Remaining
- Below: stacked breakdown
  - Per-category bucket cards
  - Per-channel bucket cards (only if channel has its own period)
- One-click "All budgeted tasks" view (sorted by allocation amount, descending — default)
- Past periods: collapsible history showing unspent budget call-outs

### 10.6 Owners list (`/owners`)

Grid of owner cards. Each card:
- Avatar, name
- Open tasks count
- Overdue count
- Live tasks count
- Mentioned count

### 10.7 Owner detail (`/owners/[email]`)

Tabs: **Assigned to me** | **Mentioned** | **Calendar** | **Activity**

**Assigned to me**:
- Sub-tabs by role: All / Primary / Secondary / Tertiary / Other
- Same Kanban/Table layout as category page
- Default filters: P0 only, nearing deadline, blocked by me — as quick-filter chips at the top, off by default

**Mentioned**:
- All tasks where this user is `@`-mentioned but not formally assigned
- Same card display but with the mention context shown (e.g., "Mentioned in checklist: 'Need @kailash to approve copy'")

**Calendar**: this user's tasks only (assigned + mentioned, toggle)

**Activity**: this user's activity log entries

### 10.8 My Tasks (`/me/tasks`)

Shortcut to `/owners/[currentUserEmail]`.

### 10.9 My Calendar (`/me/calendar`)

Shortcut to `/owners/[currentUserEmail]?tab=calendar`.

### 10.10 Weekly Review (`/weekly`)

Time-travel UI. Horizontal week-picker showing the last 12 weeks. Click a week → reconstructed view:

- KPI tiles at end of that week
- Breakdown by category (stacked bar)
- Breakdown by owner (bar)
- List of tasks completed that week with result URLs
- List of tasks blocked at end of week
- Budget summary: spent that week vs the bucket
- **Unspent callout**: if any monthly bucket finished with leftover, show explicitly

Data source: `weekly_snapshots` for past weeks; live computed for current week.

### 10.11 Admin (`/admin`)

Tabs:
- **Users**: list, change role, manual invite (sends Google SSO-ready email — placeholder until they SSO in)
- **Taxonomy**: tree editor for categories, channels, sub-channels (add, rename, reorder, soft-delete)
- **Custom fields**: per-channel field editor (Notion-style — name, type, surface, required, options, formula, cascade behavior)
- **Budgets**: create budget periods at global/category/channel scope, set amounts, view summaries
- **Slack**: OAuth, per-category notification channel config, test message
- **HubSpot**: OAuth, last sync status, manual sync button

### 10.12 Task detail drawer

Opens from any task card click. Right-side slideover, ~50% width.

**Tabs inside the drawer**: Details | Subtasks | Checklists | Comments | Activity | Dependencies

**Details tab**:
- Title (inline editable)
- Description (inline editable, supports @mentions, markdown)
- Status pill (dropdown — including `live`, `cancelled`)
- Priority pill (P0/P1/P2/P3 color dots)
- Due date
- Owners section: Primary | Secondary | Tertiary | Other — each with picker
- Budget allocation: dropdown to pick `budget_period`, then amount input
- Channel + parent task (if subtask) — read-only links
- Planning fields section (channel-specific, rendered from `channel_fields` where surface=planning)
- Tracker fields section (shown only if status ∈ {live, done, cancelled})
- Recurring schedule (if from template)
- Result URL + Result file upload
- Blocked-by section (visible when status = blocked): person picker OR email entry + reason text

**Subtasks tab**:
- List of subtasks (max 2 levels of nesting below this task — total depth 3)
- "+ Add subtask" — opens a mini new-task form. Critically, **channel picker is unrestricted** — subtask can be in any channel
- Each subtask shows status, owner, due — click drills into that subtask's drawer

**Checklists tab**:
- Add checklist items
- Reorder via drag
- Each item supports @mentions (which trigger implicit ownership on the parent task)
- Check off

**Comments tab**:
- Comment thread, oldest first
- Supports @mentions, file attachments (2MB)

**Activity tab**:
- Activity log filtered to this task

**Dependencies tab**:
- "Depends on" list — pick from any task in the system
- "Blocks" list — auto-populated reverse view of who depends on this

### 10.13 New task dialog

Triggered from `+ New task` button anywhere.

Required fields: title, channel, primary owner. Defaults:
- Status: not_started
- Priority: P2
- Due date: blank
- Creator: current user

Optional immediate fields: due date, description, additional owners, parent task (if creating a subtask), budget allocation, recurring schedule.

After save, drawer opens for further editing.

### 10.14 CSV upload for Leads Pipeline

Lives at `/c/leads-pipeline/all-leads` as an "Upload CSV" button.

Flow:
1. File picker (papaparse client-side)
2. Column mapping form — map CSV columns to Leads Pipeline fields (name, email, company, source_channel, generated_date, lead_status, notes). Unmapped CSV columns flow to a JSON `extra_fields` planning field
3. Preview pane: first 5 rows mapped
4. Validation: bad emails flagged, dupes detected (by email, within Leads Pipeline)
5. Dedup option: "Skip rows where email already exists" (default ON)
6. Confirm → batch insert as tasks under channel `all-leads`
7. Success toast with counts

---

## 11. Mentions & implicit ownership — behavior spec

### Trigger surfaces
- Task description
- Comments
- Checklist item bodies
- Blocked-by description
- Insights field entries

### Resolution
1. User types `@`. Autocomplete opens, sorted: most-recent-collaborators first, then alphabetical.
2. If typing an email not in the user list, allow free-form email entry (validated regex). Creates a `pending_mentions` row.
3. Stored mention has `task_id`, `surface`, `surface_ref_id` (e.g., comment id), `mentioned_user_id` (or `mentioned_email`).

### Effects when a mention is created
- Slack DM to mentioned user (if `slack_user_id` known)
- In-app notification (type=`mentioned`)
- Task appears in mentioned user's **Mentioned** tab on their owner page
- Does NOT add to `task_assignments`. Mention is distinct from assignment.

### On retroactive resolution
When a previously-unseen email signs in via Google SSO, all `pending_mentions` for that email resolve to `mentions` rows. Backfill notifications? **No** — too noisy. Just expose the now-resolved mentions in their Mentioned tab.

---

## 12. Cross-category subtask architecture — behavior spec

### Creation
- From any task's Subtasks tab, click "+ Add subtask"
- Channel picker is unrestricted: subtask can land in any channel
- Subtask is stored with `parent_task_id` pointing at parent, `nesting_level = parent.nesting_level + 1`
- Max nesting: 3 (root=0, sub=1, sub-sub=2)

### Visibility
- Subtask appears in BOTH:
  - Its own channel's Task Board (with a "subtask of [parent]" link badge)
  - Its parent's Subtasks tab
- Subtask owner sees it primarily in their **Assigned to me** view; the parent task does NOT appear there unless they're also assigned to the parent

### Status independence
- A subtask CAN transition to `live` or `done` regardless of parent's status
- Parent CANNOT transition to `done` until all subtasks are `done` or `cancelled`
- If a subtask becomes `blocked`, the parent receives a `parent_blocked` notification to its owners

### Channel inheritance
- Subtask gets its own channel's custom fields, NOT parent's
- e.g., Event > Workshop parent has workshop-specific fields; LinkedIn Ads subtask has LinkedIn Ads fields

### Example (your spec):
```
L0 Workshop: "Q3 Bangalore Launch Event" (channel: Events > Workshops)
├── L1 Subtask: "Event registration drive" (channel: Events > Workshops)
│   ├── L2 Sub-subtask: "LinkedIn ad for registration" (channel: Social > LinkedIn Ads > Lead gen ads)
│   │   └── Checklist: "Get creative approved" / "Set targeting" / "Launch"
│   └── L2 Sub-subtask: "Instantly email sequence to past attendees" (channel: Outbound > Instantly)
│       └── Checklist: "Build list in Apollo" / "Set up sequence" / "Launch"
```

---

## 13. Budget — behavior spec

### Setup (admin only)
- Admin creates `budget_periods` at start of each month (or quarter, half, annual, custom)
- Each period: scope (global / category / channel), period_type, period_label, dates, total amount
- Admin gets a reminder on the 1st of each month: "Set this month's budgets"

### Allocation (any task creator)
- When creating/editing a task, optional **Budget** field
- Pick a `budget_period` (filtered to those matching the task's channel scope and currently active)
- Enter amount
- UI shows: bucket total / currently allocated / remaining → updates live as you type
- If your allocation exceeds remaining, the warning is shown but save is allowed (warn-not-block)

### Live view
- Budget chip on every task card with an allocation
- Bucket widget at top of category/channel page if a budget exists at that scope
- Global widget on dashboard top
- All-budgeted-tasks one-click view: `/budgets` → "View all allocations" → sortable table

### Past-period unspent
- A budget period ends. Sum of allocations < total → "unspent: $X" callout
- Surfaced on:
  - Weekly Review page (for periods ending in that week)
  - `/budgets` history section
  - Optional Slack ping to admin at end of period

### Pipeline influenced (manual entry)
- The `pipeline_influenced_usd` tracker field on Events/Webinars is **manual entry** for v1
- The events owner pulls the number from a HubSpot report and types it in
- V2: pull from HubSpot directly via the existing integration

---

## 14. Notifications — what fires when

| Event | Slack | In-app | Recipients |
|---|---|---|---|
| You're assigned to a task | DM | Yes | The assignee |
| You're mentioned anywhere | DM | Yes | The mentioned user |
| Comment on a task | DM | Yes | All owners + previously-mentioned users |
| Task you own moves to `live` | DM | Yes | All owners |
| Task you own moves to `done` | DM | Yes | All owners + creator |
| Task you own moves to `blocked` | DM | Yes | All owners + creator |
| Task you own becomes overdue | DM | Yes | All owners (daily digest 9:00 IST) |
| Dependency closes | DM | Yes | All owners of dependent task |
| Subtask completes | DM | Yes | Parent task owners |
| Subtask blocked | DM | Yes | Parent task owners (`parent_blocked` type) |
| Budget allocation pushes bucket over limit | DM | Yes | Admin + task creator |
| Category-level channel notifications | Channel post | No | Configured Slack channel |

Channel posts (not DMs):
- New task created → posted to the category's configured Slack channel
- Task moves to `live` → category channel
- Task moves to `done` with result URL → category channel
- Task moves to `blocked` → category channel

No email notifications. No per-user notification preferences (v2). No quiet hours.

### Slack dispatch
- DB trigger writes to `pending_slack_notifications`
- Edge Function polls every minute, dispatches via Slack Web API, marks `dispatched_at`
- Failed attempts retry up to 3x, then admin notification

---

## 15. Sprint plan (8 sprints, ~8 weeks)

### Sprint 1 (Week 1) — Foundation
- Next.js scaffold, Tailwind, shadcn install, Vercel deploy
- Supabase project, schema migration for all tables in §5
- RLS policies
- Google SSO with `@lyzr.ai` domain restriction, user mirror trigger, kailash admin bootstrap
- Sidebar + top bar layout
- **Ship**: empty shell, can log in, see empty sidebar

### Sprint 2 (Week 2) — Taxonomy + custom field engine
- Seed categories/channels/sub-channels per §7
- Admin > Taxonomy editor (CRUD)
- Custom field engine: `channel_fields` table, cascading logic
- Admin > Custom fields editor (Notion-style)
- Seed all channel fields per §8
- **Ship**: admin can create channels and define fields; nothing user-facing yet

### Sprint 3 (Week 3) — Tasks v1 (single-level, no subtasks yet)
- Task CRUD via Server Actions
- Task detail drawer (Details tab only)
- Multi-owner assignment (Primary/Secondary/Tertiary/Other), at-least-one-required enforcement
- Channel-scoped task list (Table view)
- Status transitions including `live`, `cancelled`
- File upload to Supabase Storage
- Planning fields rendered from custom field schema
- **Ship**: can create and manage flat tasks per channel

### Sprint 4 (Week 4) — Hierarchy, mentions, checklists
- Subtasks (3 levels deep, cross-category)
- Subtasks tab in drawer
- Checklists with @mentions
- Mention parsing (description, comments, checklists, blocked description)
- Mention → notification + Mentioned tab
- Pending mentions resolution on first SSO
- Dependencies tab + auto-notification on close
- **Ship**: full task model, with subtasks and mentions working

### Sprint 5 (Week 5) — Views + filters
- Kanban view for each channel/category
- Calendar view
- Owner list + owner detail (Assigned to me / Mentioned split)
- My Tasks / My Calendar shortcuts
- Global search (cmd-K)
- Quick filter chips (P0 only, nearing deadline, blocked by me)
- Recurring tasks (simple model)
- **Ship**: real multi-view experience

### Sprint 6 (Week 6) — Tracker + Budgets
- Status-based field visibility (planning vs tracker)
- Tracker tab on every channel/category page
- Global Tracker view (`/tracker`)
- 45-day tracker freeze logic
- Auto-calc field rendering (open rate, CTR, etc.)
- Universal Insights field (numbered list, with @mention)
- Budget periods + admin UI
- Budget allocation on tasks
- Bucket widgets on dashboard/category/channel
- Global Budget view (`/budgets`)
- One-click sorted "all budgeted tasks"
- **Ship**: tracker and budgets live

### Sprint 7 (Week 7) — Integrations + activity
- Activity log triggers
- Notification system (in-app bell + Edge Function for Slack)
- Slack OAuth + per-category notification channel config
- Slack message dispatch (all event types in §14)
- HubSpot OAuth + nightly sync
- HubSpot read-only synced contacts view in Outbound > HubSpot
- Leads Pipeline CSV upload with column mapping
- **Ship**: integrations done

### Sprint 8 (Week 8) — Historical + admin + polish
- Weekly snapshot cron (nightly Edge Function)
- Weekly Review view with time travel
- Unspent budget callouts
- Mobile responsive pass
- Empty states, loading skeletons, error boundaries
- Final RLS audit
- **Ship**: v1.0 production

---

## 16. V2 backlog (deferred, not in v1)

In priority order:

1. **Task templates** — reusable scaffolds (e.g., "New webinar" scaffolds parent + 8 subtasks + custom field defaults)
2. **Formula engine for custom auto-calc tracker fields** — channel admins define their own formulas, not just the hardcoded ones
3. **AI summary of Weekly Review** — LLM-generated "what shipped, what's stuck, who's overloaded"
4. **Recurring task per-instance exceptions** — full Google Calendar parity (edit this only / this + following / whole series)
5. **Per-user notification preferences** — mute, daily digest, event-type toggles
6. **Approval gates** — high-budget or customer-facing tasks require explicit reviewer approval before `live`
7. **Channel-level KPI dashboards** — aggregated trend views per channel (LinkedIn Ads CPL over time, etc.)
8. **Track actual budget spend** — beyond allocation
9. **HubSpot pipeline influenced auto-pull** — replace manual entry for `pipeline_influenced_usd`
10. **Saved views** — "My P0s due this week" as sidebar bookmarks
11. **Bulk operations** — multi-select for reassign/status/delete
12. **Multi-currency support**
13. **Inbox view** — full-page feed of new mentions/assignments
14. **Slack quiet hours**
15. **Google Calendar sync of due dates**
16. **Monthly report generator** (PDF / email export)
17. **Custom statuses per channel**
18. **Effort estimation / time tracking**
19. **Lyzr agentic AI integration** — auto-fill tracker fields from external data sources

### Explicitly out of scope (not even v2)
- Public task sharing
- Email-to-create-task
- Mobile native app
- Real-time multiplayer cursors
- Email notifications (Slack + in-app only)
- HubSpot writes (read-only forever)
- Multi-business-unit (this is GSI/SI only by design)
- Channel admin role (single admin only)

---

## 17. Open items requiring user confirmation

These need answers before final kickoff but DO NOT block Sprint 1:

1. **Slack workspace** to install bot in (default: Lyzr corporate Slack). Admin OAuth post-deploy.
2. **HubSpot portal** to connect (default: Lyzr's GSI/SI portal). Admin OAuth post-deploy.
3. **Default Slack channel** for category-less notifications (suggest `#marketing-tracker`).
4. **Branding** — internal tool, defaulting to neutral UI (slate + single accent). Override to Lyzr brand (espresso, dusty rose) if preferred — but be aware brand-heavy backgrounds tire the eye over 8-hour workdays.
5. **Initial channels with NO custom fields** beyond auto-suggested: Co-marketing > Webinar/Podcast/Testimonial defaults look right? Events sub-channels look right? Push back per channel if anything's off.
6. **Newsletter `send_date` separate from `due_date`** — confirm. Draft might be due May 28 but send date is May 30.
7. **TOFU/MOFU/BOFU placeholder fields** on Conversation ads / PhantomBuster — left as generic numeric inputs awaiting your definition. Acceptable for v1?

---

## 18. Conventions for the implementing agent

- File structure: `app/` for routes, `components/` for shared UI, `lib/` for utilities, `lib/supabase/` for client + server Supabase clients, `lib/slack/`, `lib/hubspot/`, `lib/budgets/`, `lib/tasks/`, `lib/fields/` for custom field engine logic, `types/` shared, `supabase/migrations/` for SQL
- Naming: kebab-case files, PascalCase components, camelCase functions
- Type safety: generate types from Supabase schema (`supabase gen types typescript`)
- Server actions for mutations
- No client-side service-role key
- Optimistic updates for status changes, assignment changes, checklist toggles
- Empty states everywhere; clean text + CTA, no oversized illustrations
- Toasts via sonner
- Forms with react-hook-form + zod
- **No em dashes** in any user-facing copy (Lyzr brand convention)
- Fonts: Inter for the app UI (internal tooling — legibility over brand)
- All dates rendered in IST via date-fns-tz; DB stores UTC
- @mention parser: regex `/@([\w.-]+@[\w.-]+\.\w+|\S+)/g` — both `@kailash` (resolved against users by email match) and `@kailash.gm@lyzr.ai` work

---

## End of spec

To kick off: *"Start with Sprint 1. Set up the Next.js project, Supabase project, run the schema migration, configure Google SSO with @lyzr.ai domain restriction, bootstrap kailash.gm@lyzr.ai as admin. Stop after I can sign in and see the empty shell."*
