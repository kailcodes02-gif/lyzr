-- ============================================================
-- Lyzr Comms Coverage Tracker - Core v0 Schema
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============ ENUMS ============

CREATE TYPE user_role AS ENUM ('admin', 'member');

CREATE TYPE account_status AS ENUM ('active_customer', 'prospect', 'churned', 'unknown');
CREATE TYPE match_confidence AS ENUM ('confirmed', 'probable', 'unmatched');

CREATE TYPE source_system_type AS ENUM ('cortex', 'hubspot', 'instantly');
CREATE TYPE source_object_type AS ENUM ('client', 'company', 'deal', 'campaign_lead_company');
CREATE TYPE link_match_status AS ENUM ('matched', 'ambiguous', 'unmatched');
CREATE TYPE match_method AS ENUM ('domain_exact', 'domain_fuzzy', 'name_fuzzy', 'manual');

CREATE TYPE person_type AS ENUM ('lyzr_internal', 'client_poc');
CREATE TYPE relationship_role AS ENUM (
  'internal_owner', 'internal_contributor',
  'client_poc_primary', 'client_poc_secondary', 'client_poc_other'
);

CREATE TYPE comm_source_system AS ENUM ('instantly', 'hubspot_engagement');
CREATE TYPE comm_email_type AS ENUM ('product_update', 'cold_outbound', 'manual_sales', 'reply', 'other');
CREATE TYPE comm_match_status AS ENUM ('matched', 'person_unmatched', 'account_unmatched', 'both_unmatched');
CREATE TYPE comm_origin AS ENUM ('synced', 'sent_via_app');

CREATE TYPE task_status AS ENUM ('open', 'in_progress', 'done', 'cancelled');

CREATE TYPE sync_run_type AS ENUM ('scheduled', 'manual');
CREATE TYPE sync_run_status AS ENUM ('running', 'success', 'partial', 'failed');

-- ============ USERS (mirrors auth.users) ============

CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  role user_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ PEOPLE (internal Lyzr + client POCs, sourced from Cortex/HubSpot) ============

CREATE TABLE people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT,
  email TEXT,
  person_type person_type NOT NULL,
  role_title TEXT,
  team TEXT,
  cortex_person_id TEXT UNIQUE,
  hubspot_contact_id TEXT UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX people_email_unique_idx ON people (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX people_type_idx ON people (person_type);

-- ============ ACCOUNTS (normalized customer account) ============

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  primary_domain TEXT,
  hubspot_company_id TEXT UNIQUE,
  cortex_client_id TEXT UNIQUE,
  lifecycle_stage TEXT,
  deal_stage_bucket TEXT,
  is_customer BOOLEAN NOT NULL DEFAULT false,
  status account_status NOT NULL DEFAULT 'unknown',
  product_engaged JSONB NOT NULL DEFAULT '[]'::jsonb,
  internal_owner_person_id UUID REFERENCES people(id) ON DELETE SET NULL,
  match_confidence match_confidence NOT NULL DEFAULT 'unmatched',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX accounts_primary_domain_idx ON accounts (primary_domain);
CREATE INDEX accounts_is_customer_idx ON accounts (is_customer);
CREATE INDEX accounts_status_idx ON accounts (status);
CREATE INDEX accounts_name_trgm_idx ON accounts USING gin (canonical_name gin_trgm_ops);

-- ============ ACCOUNT_SOURCE_LINKS (reconciliation ledger — nothing dropped silently) ============

CREATE TABLE account_source_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  source_system source_system_type NOT NULL,
  source_object_type source_object_type NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT,
  source_domain TEXT,
  match_status link_match_status NOT NULL DEFAULT 'unmatched',
  match_method match_method,
  match_score NUMERIC,
  candidate_account_ids UUID[],
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_object_type, source_id)
);

CREATE INDEX account_source_links_match_status_idx ON account_source_links (match_status);
CREATE INDEX account_source_links_account_idx ON account_source_links (account_id);

-- ============ ACCOUNT_PEOPLE (who's a POC/owner for which account — Cortex org structure) ============

CREATE TABLE account_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  relationship_role relationship_role NOT NULL,
  source_system source_system_type NOT NULL DEFAULT 'cortex',
  is_current BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  UNIQUE (account_id, person_id, relationship_role)
);

CREATE INDEX account_people_account_current_idx ON account_people (account_id, is_current);
CREATE INDEX account_people_person_idx ON account_people (person_id);

-- ============ INSTANTLY_CAMPAIGNS (cache, used to classify email_type by tag) ============

CREATE TABLE instantly_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT,
  tags JSONB,
  status TEXT,
  created_at_source TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ TASKS & TASK_ITEMS (the "send an update email" workflow) ============

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cortex_project_id TEXT,
  task_type TEXT NOT NULL DEFAULT 'send_update_email'
    CHECK (task_type IN ('send_update_email')),
  description TEXT,
  due_date DATE,
  status task_status NOT NULL DEFAULT 'open',
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tasks_account_idx ON tasks (account_id);
CREATE INDEX tasks_status_idx ON tasks (status);
CREATE INDEX tasks_due_date_idx ON tasks (due_date);

CREATE TABLE task_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  assignee_person_id UUID REFERENCES people(id) ON DELETE SET NULL,
  order_index INT NOT NULL DEFAULT 0,
  is_done BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX task_items_task_idx ON task_items (task_id);
CREATE INDEX task_items_assignee_idx ON task_items (assignee_person_id);

-- ============ COMMUNICATION_EVENTS (individual emails — synced or sent via app) ============

CREATE TABLE communication_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  person_id UUID REFERENCES people(id) ON DELETE SET NULL,
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  source_system comm_source_system NOT NULL,
  source_event_id TEXT NOT NULL,
  source_campaign_id TEXT REFERENCES instantly_campaigns(id) ON DELETE SET NULL,
  sender_email TEXT,
  recipient_email TEXT NOT NULL,
  recipient_email_domain TEXT,
  subject TEXT,
  snippet TEXT,
  ai_summary TEXT,
  sent_at TIMESTAMPTZ NOT NULL,
  email_type comm_email_type,
  match_status comm_match_status NOT NULL DEFAULT 'matched',
  origin comm_origin NOT NULL DEFAULT 'synced',
  task_item_id UUID REFERENCES task_items(id) ON DELETE SET NULL,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_event_id)
);

CREATE INDEX comm_events_account_sent_idx ON communication_events (account_id, sent_at DESC);
CREATE INDEX comm_events_person_sent_idx ON communication_events (person_id, sent_at DESC);
CREATE INDEX comm_events_match_status_idx ON communication_events (match_status);

-- ============ ACCOUNT_MONTH_COVERAGE (monthly rollup view) ============

CREATE VIEW account_month_coverage AS
SELECT
  a.id AS account_id,
  date_trunc('month', ce.sent_at) AS month,
  count(*) AS email_count,
  count(DISTINCT ce.person_id) FILTER (
    WHERE ap.relationship_role::text LIKE 'client_poc%' AND ap.is_current
  ) AS distinct_pocs_reached,
  bool_or(ap.relationship_role::text LIKE 'client_poc%' AND ap.is_current) AS had_coverage,
  max(ce.sent_at) AS last_email_at
FROM communication_events ce
JOIN accounts a ON a.id = ce.account_id
LEFT JOIN account_people ap ON ap.account_id = ce.account_id AND ap.person_id = ce.person_id
WHERE ce.match_status = 'matched'
GROUP BY a.id, date_trunc('month', ce.sent_at);

-- ============ SYNC / JOB METADATA ============

CREATE TABLE sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system source_system_type NOT NULL,
  run_type sync_run_type NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status sync_run_status NOT NULL DEFAULT 'running',
  records_fetched INT,
  records_upserted INT,
  records_flagged_for_review INT,
  error_message TEXT,
  triggered_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX sync_runs_source_started_idx ON sync_runs (source_system, started_at DESC);

CREATE TABLE source_sync_state (
  source_key TEXT PRIMARY KEY,
  last_synced_at TIMESTAMPTZ,
  last_cursor JSONB,
  last_run_id UUID REFERENCES sync_runs(id) ON DELETE SET NULL
);

-- ============ TRIGGERS ============

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_updated_at
  BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER people_updated_at
  BEFORE UPDATE ON people FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER account_source_links_updated_at
  BEFORE UPDATE ON account_source_links FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Mirror auth.users to public.users. Adjust the admin email below as needed.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    CASE WHEN NEW.email = 'subs@lyzr.ai' THEN 'admin'::user_role ELSE 'member'::user_role END
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============ RLS ============
-- Internal tool behind @lyzr.ai Google SSO: permissive read for everyone
-- signed in. Writes to sync-owned tables (accounts/people/links/comm events/
-- campaigns/sync metadata) are intentionally NOT opened to authenticated
-- clients — those go through Worker routes using the service-role client,
-- which bypasses RLS. Tasks/task_items ARE meant to be created/edited
-- directly by any signed-in user (the collaborative workflow layer).

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_source_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE instantly_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON people FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON account_source_links FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON account_people FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON instantly_campaigns FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON task_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON communication_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON sync_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON source_sync_state FOR SELECT TO authenticated USING (true);

-- Collaborative task workflow: any signed-in user can create/edit tasks & items.
CREATE POLICY "auth_insert" ON tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete" ON tasks FOR DELETE TO authenticated USING (true);

CREATE POLICY "auth_insert" ON task_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON task_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete" ON task_items FOR DELETE TO authenticated USING (true);
