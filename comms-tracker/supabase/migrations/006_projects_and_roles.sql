-- ============================================================
-- Account -> Projects -> Stakeholders hierarchy, plus admin-configurable
-- internal owner roles (Product Owner / Deal Owner / Project Owner).
-- Run after 001-005. Schema hadn't reached the live project yet at the time
-- of this migration, so this reshapes account_people's owner-role concept
-- directly rather than carrying a backward-compat path.
-- ============================================================

CREATE TYPE project_status AS ENUM ('active', 'paused', 'completed', 'unknown');
CREATE TYPE project_role_source AS ENUM ('cortex', 'hubspot', 'manual');

-- Knowledge-base and future sources reuse sync_runs/source_sync_state (both
-- already source-agnostic enough) rather than inventing a parallel job-log
-- mechanism — see 007_knowledge_base.sql.
ALTER TYPE source_system_type ADD VALUE IF NOT EXISTS 'lyzr_blog';
ALTER TYPE source_system_type ADD VALUE IF NOT EXISTS 'lyzr_case_study';
ALTER TYPE source_system_type ADD VALUE IF NOT EXISTS 'slack';
ALTER TYPE source_system_type ADD VALUE IF NOT EXISTS 'drive';
ALTER TYPE source_system_type ADD VALUE IF NOT EXISTS 'meeting_notes';
ALTER TYPE source_system_type ADD VALUE IF NOT EXISTS 'internal_email';

-- The Gmail/Outlook compose-handoff send flow logs an optimistic
-- communication_events row the moment a user clicks through -- it isn't a
-- HubSpot engagement or an Instantly send, so it needs its own
-- comm_source_system value rather than being mislabeled as one of those.
ALTER TYPE comm_source_system ADD VALUE IF NOT EXISTS 'app';

-- ============ ROLES (admin-configurable internal owner roles) ============

CREATE TABLE roles (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO roles (key, label, sort_order) VALUES
  ('product_owner', 'Product Owner', 0),
  ('deal_owner', 'Deal Owner', 1),
  ('project_owner', 'Project Owner', 2);

CREATE TRIGGER roles_updated_at
  BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============ PROJECTS ============

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cortex_project_id TEXT UNIQUE,
  name TEXT NOT NULL,
  status project_status NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX projects_account_idx ON projects (account_id);

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============ PROJECT_PEOPLE (project-scoped stakeholders) ============
-- One row is EITHER an internal owner-role assignment (role_key, FK into the
-- admin-editable `roles` table) OR an external client-POC assignment
-- (relationship_role, reusing 001's enum) -- never both; the CHECK below
-- enforces that. Manual overrides (is_manual_override = true) are sticky:
-- sync must never overwrite or replace them, same pattern as
-- account_source_links.reviewed_at.
--
-- Two PARTIAL unique indexes instead of one table-level UNIQUE: a
-- UNIQUE(...) constraint never flags a duplicate row if any of its columns
-- is NULL (NULL <> NULL), and role_key/relationship_role are NULL on
-- exactly the rows the other one is meant to dedupe.

CREATE TABLE project_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role_key TEXT REFERENCES roles(key) ON DELETE RESTRICT,
  relationship_role relationship_role,
  source_system project_role_source NOT NULL DEFAULT 'cortex',
  is_manual_override BOOLEAN NOT NULL DEFAULT false,
  is_current BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  CHECK (
    (role_key IS NOT NULL AND relationship_role IS NULL) OR
    (role_key IS NULL AND relationship_role IS NOT NULL)
  )
);

CREATE UNIQUE INDEX project_people_role_unique_idx
  ON project_people (project_id, person_id, role_key) WHERE role_key IS NOT NULL;
CREATE UNIQUE INDEX project_people_relationship_unique_idx
  ON project_people (project_id, person_id, relationship_role) WHERE relationship_role IS NOT NULL;
CREATE INDEX project_people_project_current_idx ON project_people (project_id, is_current);
CREATE INDEX project_people_person_idx ON project_people (person_id);

-- ============ COMMUNICATION_EVENTS: project scoping ============

ALTER TABLE communication_events ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS comm_events_project_sent_idx ON communication_events (project_id, sent_at DESC);

-- ============ VIEWS ============

-- Per-project last-contact rollup, mirroring account_last_contact (002) —
-- used for the 4-shade going-dark grading, which is computed per project
-- and rolled up to the account row as its worst project's bucket.
CREATE VIEW project_last_contact AS
SELECT
  project_id,
  max(sent_at) AS last_contact_at,
  count(*) AS total_emails
FROM communication_events
WHERE match_status = 'matched' AND project_id IS NOT NULL
GROUP BY project_id;

-- Account-level rollup of project-scoped stakeholders, so the existing
-- Account Tracker list keeps showing one Product/Deal Owner column per
-- account without every reader needing to join through projects itself.
CREATE VIEW account_people_rollup AS
SELECT DISTINCT
  p.account_id,
  pp.role_key,
  pp.relationship_role,
  pp.person_id,
  pp.is_current
FROM project_people pp
JOIN projects p ON p.id = pp.project_id;

-- Per-project going-dark staleness, one row per project (NULL last_contact_at
-- for a project with no matched email at all -- the going-dark UI treats
-- NULL as maximally stale, same convention as the existing account-level
-- "never contacted" handling). Account rows in the tracker show whichever of
-- their projects is furthest past the 15-day threshold.
CREATE VIEW project_staleness AS
SELECT
  proj.id AS project_id,
  proj.account_id,
  plc.last_contact_at,
  COALESCE(plc.total_emails, 0) AS total_emails
FROM projects proj
LEFT JOIN project_last_contact plc ON plc.project_id = proj.id;

-- ============ RLS ============
-- Same posture as 001/005: permissive read for anyone signed in.
-- `roles` and per-project owner *reassignment* are the one place regular
-- account_people-style tables get opened to authenticated writes at all,
-- because that's a deliberate admin dashboard action (Phase 3's "Reassign"
-- control), not a sync-owned table — sync itself still writes through the
-- Worker's service-role client, which bypasses RLS entirely.

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_people ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON project_people FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin_write_roles" ON roles FOR ALL TO authenticated
  USING ((SELECT role FROM users WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');

-- Admins can insert/update a project_people row to reassign an owner role
-- (the manual-override path) — never delete (ended_at/is_current=false is
-- how an assignment retires, keeping history intact).
CREATE POLICY "admin_write_project_people" ON project_people FOR INSERT TO authenticated
  WITH CHECK ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');
CREATE POLICY "admin_update_project_people" ON project_people FOR UPDATE TO authenticated
  USING ((SELECT role FROM users WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');
