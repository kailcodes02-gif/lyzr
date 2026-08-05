-- ============================================================
-- Migration 011: Lead dashboards (HubSpot pull + CSV email interactions)
-- HubSpot is READ-ONLY (pulled, never written). Outreach statuses live here.
-- One tracking table serves both dashboards: ref_id is a HubSpot contact id
-- for pulled leads, or 'email:<address>' for CSV-imported leads.
-- Idempotent. Safe to re-run. PASTE INTO SUPABASE SQL EDITOR.
-- ============================================================

-- Extra companies (on top of the built-in pull rule)
CREATE TABLE IF NOT EXISTS lead_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-lead outreach state (dropdown stages)
CREATE TABLE IF NOT EXISTS lead_tracking (
  ref_id TEXT PRIMARY KEY,
  email_stage TEXT CHECK (email_stage IN ('e1', 'e2', 'e3')),
  call_status TEXT CHECK (call_status IN ('yes', 'no', 'declined', 'no_response')),
  li_stage TEXT CHECK (li_stage IN ('conn', 'm1', 'm2')),
  wa_status TEXT CHECK (wa_status IN ('sent', 'not_sent', 'not_demo')),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CSV-imported email-interaction leads — retained indefinitely across uploads
CREATE TABLE IF NOT EXISTS email_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  company TEXT,
  demo_click_date DATE,
  -- every other column from the uploaded CSV, shown verbatim on the dashboard
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_leads_demo_date_idx ON email_leads(demo_click_date);

ALTER TABLE lead_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_tracking  ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_leads    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_companies_read"  ON lead_companies;
DROP POLICY IF EXISTS "lead_companies_write" ON lead_companies;
CREATE POLICY "lead_companies_read"  ON lead_companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "lead_companies_write" ON lead_companies FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "lead_tracking_read"  ON lead_tracking;
DROP POLICY IF EXISTS "lead_tracking_write" ON lead_tracking;
CREATE POLICY "lead_tracking_read"  ON lead_tracking FOR SELECT TO authenticated USING (true);
CREATE POLICY "lead_tracking_write" ON lead_tracking FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "email_leads_read"  ON email_leads;
DROP POLICY IF EXISTS "email_leads_write" ON email_leads;
CREATE POLICY "email_leads_read"  ON email_leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "email_leads_write" ON email_leads FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON lead_companies, lead_tracking, email_leads TO authenticated, service_role;
