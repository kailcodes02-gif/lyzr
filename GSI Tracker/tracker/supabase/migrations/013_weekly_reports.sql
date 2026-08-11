-- ============================================================
-- Migration 013: Weekly Report generator
-- Backs the "Create Weekly Report" button on /weekly: a manual ad-spend
-- ledger (no ads-platform integration exists yet), free-form "done" items
-- that do NOT create real tasks, and the generated report HTML itself,
-- keyed by ISO week_starting (Monday) to match weekly_snapshots.
-- Idempotent. Safe to re-run. PASTE INTO SUPABASE SQL EDITOR.
-- ============================================================

CREATE TABLE IF NOT EXISTS report_ad_spend (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_starting DATE NOT NULL,
  platform TEXT NOT NULL,
  campaign TEXT,
  spend NUMERIC(12,2) NOT NULL DEFAULT 0,
  leads INT,
  notes TEXT,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_ad_spend_week_idx ON report_ad_spend(week_starting);

-- Free-form "task / subtask done" bullets for the report only — explicitly
-- NOT rows in the `tasks` table, so they never appear on any tracker board.
CREATE TABLE IF NOT EXISTS report_done_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_starting DATE NOT NULL,
  task_title TEXT NOT NULL,
  subtask_title TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_done_items_week_idx ON report_done_items(week_starting);

-- The generated report itself. "Create Weekly Report" upserts this row for
-- the selected week; `summary` keeps the structured inputs so the report can
-- be regenerated/edited later without re-deriving everything from scratch.
CREATE TABLE IF NOT EXISTS weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_starting DATE NOT NULL UNIQUE,
  week_ending DATE NOT NULL,
  html TEXT NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE report_ad_spend   ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_done_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_reports    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "report_ad_spend_read"  ON report_ad_spend;
DROP POLICY IF EXISTS "report_ad_spend_write" ON report_ad_spend;
CREATE POLICY "report_ad_spend_read"  ON report_ad_spend FOR SELECT TO authenticated USING (true);
CREATE POLICY "report_ad_spend_write" ON report_ad_spend FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "report_done_items_read"  ON report_done_items;
DROP POLICY IF EXISTS "report_done_items_write" ON report_done_items;
CREATE POLICY "report_done_items_read"  ON report_done_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "report_done_items_write" ON report_done_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "weekly_reports_read"  ON weekly_reports;
DROP POLICY IF EXISTS "weekly_reports_write" ON weekly_reports;
CREATE POLICY "weekly_reports_read"  ON weekly_reports FOR SELECT TO authenticated USING (true);
CREATE POLICY "weekly_reports_write" ON weekly_reports FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON report_ad_spend, report_done_items, weekly_reports TO authenticated, service_role;
