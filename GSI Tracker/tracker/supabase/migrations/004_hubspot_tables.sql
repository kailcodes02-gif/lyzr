-- ==========================================
-- CREATE HUBSPOT SYNC TABLES
-- ==========================================

CREATE TABLE hubspot_connection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_id TEXT NOT NULL UNIQUE,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  connected_by UUID NOT NULL REFERENCES users(id),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sync_at TIMESTAMPTZ
);

CREATE TABLE hubspot_synced_contacts (
  hubspot_contact_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  company TEXT,
  lifecycle_stage TEXT,
  sequence_memberships JSONB NOT NULL DEFAULT '[]'::jsonb, -- which sequences they're enrolled in
  raw_properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE hubspot_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE hubspot_synced_contacts ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/write connection status (admins can perform full edits)
CREATE POLICY "auth_read" ON hubspot_connection FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON hubspot_connection FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Allow authenticated users to read synced contacts, and writes for authenticated users (handled via service client or API)
CREATE POLICY "auth_read" ON hubspot_synced_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON hubspot_synced_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);
