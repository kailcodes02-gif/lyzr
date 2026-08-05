-- ============================================================
-- Migration 011: HubSpot lead pull (read-only) + local outreach tracking
-- Leads are PULLED from HubSpot (never written back). What the team does
-- about each lead (emails, LinkedIn, WhatsApp, call booking) is tracked
-- here, in our own database only.
-- Idempotent. Safe to re-run. PASTE INTO SUPABASE SQL EDITOR.
-- ============================================================

-- Companies whose leads we pull
CREATE TABLE IF NOT EXISTS lead_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-lead outreach state, keyed by the HubSpot contact id
CREATE TABLE IF NOT EXISTS lead_tracking (
  hubspot_contact_id TEXT PRIMARY KEY,
  email_1_sent BOOL NOT NULL DEFAULT FALSE,
  email_2_sent BOOL NOT NULL DEFAULT FALSE,
  email_3_sent BOOL NOT NULL DEFAULT FALSE,
  call_status TEXT CHECK (call_status IN ('yes', 'no', 'declined', 'no_response')),
  li_connection_sent BOOL NOT NULL DEFAULT FALSE,
  li_msg_1_sent BOOL NOT NULL DEFAULT FALSE,
  li_msg_2_sent BOOL NOT NULL DEFAULT FALSE,
  wa_sent BOOL NOT NULL DEFAULT FALSE,
  not_book_demo BOOL NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lead_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_tracking  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_companies_read"  ON lead_companies;
DROP POLICY IF EXISTS "lead_companies_write" ON lead_companies;
CREATE POLICY "lead_companies_read"  ON lead_companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "lead_companies_write" ON lead_companies FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "lead_tracking_read"  ON lead_tracking;
DROP POLICY IF EXISTS "lead_tracking_write" ON lead_tracking;
CREATE POLICY "lead_tracking_read"  ON lead_tracking FOR SELECT TO authenticated USING (true);
CREATE POLICY "lead_tracking_write" ON lead_tracking FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON lead_companies, lead_tracking TO authenticated, service_role;
