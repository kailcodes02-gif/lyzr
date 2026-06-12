-- ============================================================
-- MIGRATION 005: Apply Phase 2 (originally 002) + Phase 3 (originally 003)
--   idempotently. Safe to re-run.
--
-- Why this file exists:
--   Migrations 002 and 003 were never run against the deployed DB. The code
--   in lib/actions/index.ts and lib/hooks/use-data.ts references tables and
--   columns from those migrations (recurring_templates, task_dependencies,
--   slack_settings, weekly_snapshots, pending_slack_notifications, and the
--   tasks.recurring_template_id + tasks.tracker_frozen_at columns), so every
--   mutation that touches them fails with PGRST204/205.
--
-- What this does:
--   1. Creates enum `recurrence_pattern` (skipping if it already exists).
--   2. Creates table `recurring_templates` and adds the two missing columns
--      to `tasks` (recurring_template_id, tracker_frozen_at).
--   3. Creates tables `task_dependencies`, `weekly_snapshots`, `slack_settings`.
--   4. Creates table `pending_slack_notifications` (from migration 003).
--   5. Replaces `handle_task_status_change` with the Phase 2 version that
--      sets `tracker_frozen_at` 45 days after live/done.
--   6. Enables RLS + (re-)creates permissive auth policies on all new tables.
--   7. Adds indexes.
--
-- Order matters:
--   - Types and tables created before columns that reference them.
--   - Trigger function replaced AFTER the column it references is added.
-- ============================================================

-- ---------- 1. Enum: recurrence_pattern ----------
DO $$ BEGIN
  CREATE TYPE recurrence_pattern AS ENUM ('daily', 'weekly', 'biweekly', 'monthly', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------- 2. Table: recurring_templates ----------
CREATE TABLE IF NOT EXISTS recurring_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  default_priority task_priority NOT NULL DEFAULT 'P2',
  default_planning_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  pattern recurrence_pattern NOT NULL,
  custom_interval_days INT,
  starts_on DATE NOT NULL,
  ends_on DATE,
  next_due_date DATE NOT NULL,
  default_assignees UUID[] NOT NULL DEFAULT '{}',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOL NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS recurring_templates_next_due_idx
  ON recurring_templates(next_due_date) WHERE is_active = true;

-- ---------- 3. New columns on tasks ----------
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS recurring_template_id UUID
    REFERENCES recurring_templates(id) ON DELETE SET NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS tracker_frozen_at TIMESTAMPTZ;

-- ---------- 4. Table: task_dependencies ----------
CREATE TABLE IF NOT EXISTS task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE INDEX IF NOT EXISTS task_deps_task_idx ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS task_deps_depends_on_idx ON task_dependencies(depends_on_task_id);

-- ---------- 5. Table: weekly_snapshots ----------
CREATE TABLE IF NOT EXISTS weekly_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_starting DATE NOT NULL UNIQUE,
  total_tasks INT NOT NULL,
  completed_tasks INT NOT NULL,
  blocked_tasks INT NOT NULL,
  live_tasks INT NOT NULL,
  in_progress_tasks INT NOT NULL,
  not_started_tasks INT NOT NULL,
  cancelled_tasks INT NOT NULL,
  by_category JSONB NOT NULL,
  by_owner JSONB NOT NULL,
  budget_summary JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 6. Table: slack_settings ----------
CREATE TABLE IF NOT EXISTS slack_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  slack_channel_id TEXT NOT NULL,
  notify_on_create BOOL NOT NULL DEFAULT true,
  notify_on_complete BOOL NOT NULL DEFAULT true,
  notify_on_blocked BOOL NOT NULL DEFAULT true,
  notify_on_live BOOL NOT NULL DEFAULT true,
  notify_on_overdue BOOL NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 7. Table: pending_slack_notifications (migration 003) ----------
CREATE TABLE IF NOT EXISTS pending_slack_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

-- ---------- 8. Trigger function: Phase 2 version of handle_task_status_change ----------
CREATE OR REPLACE FUNCTION handle_task_status_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'live' AND OLD.status != 'live' THEN
    NEW.went_live_at = COALESCE(NEW.went_live_at, now());
    NEW.tracker_frozen_at = COALESCE(NEW.tracker_frozen_at, now() + INTERVAL '45 days');
  END IF;
  IF NEW.status = 'done' AND OLD.status != 'done' THEN
    NEW.completed_at = COALESCE(NEW.completed_at, now());
    NEW.tracker_frozen_at = COALESCE(NEW.tracker_frozen_at, now() + INTERVAL '45 days');
  END IF;
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    NEW.cancelled_at = COALESCE(NEW.cancelled_at, now());
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger itself already exists from migration 001 and is bound to the
-- function by name, so the CREATE OR REPLACE above is enough — no need
-- to DROP/CREATE the trigger.

-- ---------- 9. RLS on new tables ----------
ALTER TABLE recurring_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_snapshots           ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_settings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_slack_notifications ENABLE ROW LEVEL SECURITY;

-- ---------- 10. Policies (drop + create — no CREATE POLICY IF NOT EXISTS) ----------
DROP POLICY IF EXISTS "auth_read"  ON recurring_templates;
DROP POLICY IF EXISTS "auth_write" ON recurring_templates;
CREATE POLICY "auth_read"  ON recurring_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON recurring_templates FOR ALL    TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_read"  ON task_dependencies;
DROP POLICY IF EXISTS "auth_write" ON task_dependencies;
CREATE POLICY "auth_read"  ON task_dependencies FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON task_dependencies FOR ALL    TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_read"  ON weekly_snapshots;
DROP POLICY IF EXISTS "auth_write" ON weekly_snapshots;
CREATE POLICY "auth_read"  ON weekly_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON weekly_snapshots FOR ALL    TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_read"  ON slack_settings;
DROP POLICY IF EXISTS "auth_write" ON slack_settings;
CREATE POLICY "auth_read"  ON slack_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON slack_settings FOR ALL    TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_read"  ON pending_slack_notifications;
DROP POLICY IF EXISTS "auth_write" ON pending_slack_notifications;
CREATE POLICY "auth_read"  ON pending_slack_notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON pending_slack_notifications FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- DONE. Verify with the Step 0 diagnostic again — all sections
-- should now report the Phase 2 / 3 schema is present.
-- ============================================================
