-- ==========================================
-- PHASE 2 SCHEMA MIGRATION
-- ==========================================

-- 1. Create Recurrence Pattern type and templates table
CREATE TYPE recurrence_pattern AS ENUM ('daily', 'weekly', 'biweekly', 'monthly', 'custom');

CREATE TABLE recurring_templates (
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

CREATE INDEX recurring_templates_next_due_idx ON recurring_templates(next_due_date) WHERE is_active = true;

-- 2. Alter tasks table to reference templates and add freeze date
ALTER TABLE tasks ADD COLUMN recurring_template_id UUID REFERENCES recurring_templates(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN tracker_frozen_at TIMESTAMPTZ;

-- 3. Create task dependencies table
CREATE TABLE task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE INDEX task_deps_task_idx ON task_dependencies(task_id);
CREATE INDEX task_deps_depends_on_idx ON task_dependencies(depends_on_task_id);

-- 4. Create weekly snapshots table
CREATE TABLE weekly_snapshots (
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

-- 5. Create slack settings table
CREATE TABLE slack_settings (
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

-- ============ Enable Row Level Security (RLS) ============

ALTER TABLE recurring_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_settings ENABLE ROW LEVEL SECURITY;

-- ============ RLS Policies ============

CREATE POLICY "auth_read" ON recurring_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON recurring_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read" ON task_dependencies FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON task_dependencies FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read" ON weekly_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON weekly_snapshots FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_read" ON slack_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON slack_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. Trigger update to set tracker_frozen_at on status changes
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

