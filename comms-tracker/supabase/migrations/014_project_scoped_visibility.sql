-- ============================================================
-- Non-admin visibility scoping: everyone except an admin only sees the
-- accounts and projects they are an internal POC on (a current
-- project_people row, or the legacy account-level internal_owner/
-- internal_contributor role) -- not the whole tracker. Admins are
-- unrestricted, exactly as before.
--
-- "Internal POC" here means a project_people row with role_key set (the
-- admin-configurable owner roles: Product/Deal/Project Owner and anything
-- added later) or relationship_role IN ('internal_owner',
-- 'internal_contributor') -- i.e. the CHECK constraint's non-client-POC
-- side, matched to the signed-in user's own email in people.email.
--
-- Pages themselves need no code changes: useAccounts()/useAccountDetail()/
-- useAccountProjects()/useProjectDetail() already just SELECT the tables
-- below through the signed-in user's session, so the Tracker home page
-- naturally shows only what RLS returns.
-- ============================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin');
$$;

-- people.id for whichever person record matches the signed-in user's own
-- email (people.email is uniquely indexed case-insensitively, so this is
-- at most one row) -- the join point between "who is logged in" and
-- "who is a project stakeholder", since neither table has a direct FK to
-- the other.
CREATE OR REPLACE FUNCTION current_person_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id FROM people p
  JOIN users u ON lower(u.email) = lower(p.email)
  WHERE u.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION visible_project_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pp.project_id
  FROM project_people pp
  WHERE pp.is_current = true
    AND pp.person_id IN (SELECT current_person_ids())
    AND (pp.role_key IS NOT NULL OR pp.relationship_role IN ('internal_owner', 'internal_contributor'));
$$;

CREATE OR REPLACE FUNCTION visible_account_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT pr.account_id FROM projects pr WHERE pr.id IN (SELECT visible_project_ids())
  UNION
  SELECT DISTINCT ap.account_id FROM account_people ap
  WHERE ap.is_current = true
    AND ap.person_id IN (SELECT current_person_ids())
    -- 'deal_owner' is included here too: pre-project-redesign data still
    -- has 7 account-level deal_owner rows (verified 2026-09-09) for
    -- accounts that predate project_people; today's HubSpot sync writes
    -- deal_owner into project_people instead, but these legacy rows still
    -- decide who can see the account until each gets a project.
    AND ap.relationship_role IN ('internal_owner', 'internal_contributor', 'deal_owner');
$$;

-- ---- accounts / projects / their stakeholder join tables ----

DROP POLICY IF EXISTS "auth_read" ON accounts;
CREATE POLICY "read_visible_or_admin" ON accounts FOR SELECT TO authenticated
  USING (is_admin() OR id IN (SELECT visible_account_ids()));

DROP POLICY IF EXISTS "auth_read" ON projects;
CREATE POLICY "read_visible_or_admin" ON projects FOR SELECT TO authenticated
  USING (is_admin() OR id IN (SELECT visible_project_ids()));

DROP POLICY IF EXISTS "auth_read" ON project_people;
CREATE POLICY "read_visible_or_admin" ON project_people FOR SELECT TO authenticated
  USING (is_admin() OR project_id IN (SELECT visible_project_ids()));

DROP POLICY IF EXISTS "auth_read" ON account_people;
CREATE POLICY "read_visible_or_admin" ON account_people FOR SELECT TO authenticated
  USING (is_admin() OR account_id IN (SELECT visible_account_ids()));

-- ---- communication_events: visible via either its project or its account ----

DROP POLICY IF EXISTS "auth_read" ON communication_events;
CREATE POLICY "read_visible_or_admin" ON communication_events FOR SELECT TO authenticated
  USING (
    is_admin()
    OR project_id IN (SELECT visible_project_ids())
    OR account_id IN (SELECT visible_account_ids())
  );

-- ---- tasks / task_items: an account-level artifact, same scoping ----

DROP POLICY IF EXISTS "auth_read" ON tasks;
CREATE POLICY "read_visible_or_admin" ON tasks FOR SELECT TO authenticated
  USING (is_admin() OR account_id IN (SELECT visible_account_ids()));

DROP POLICY IF EXISTS "auth_insert" ON tasks;
CREATE POLICY "insert_visible_or_admin" ON tasks FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR account_id IN (SELECT visible_account_ids()));

DROP POLICY IF EXISTS "auth_read" ON task_items;
CREATE POLICY "read_visible_or_admin" ON task_items FOR SELECT TO authenticated
  USING (
    is_admin()
    OR EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_items.task_id AND t.account_id IN (SELECT visible_account_ids()))
  );

-- ---- close the RLS-bypass gap in dashboard views ----
-- Views run with the OWNER's privileges by default (they were created by
-- the migration-running superuser, which bypasses RLS entirely), so
-- without security_invoker every one of the RLS policies above would be
-- silently skipped whenever a page reads through account_last_contact /
-- project_staleness / etc. instead of the base table directly. This is the
-- standard Supabase "Security Definer View" gotcha; security_invoker (PG15+)
-- makes the view enforce RLS as the calling user instead.
ALTER VIEW account_last_contact SET (security_invoker = on);
ALTER VIEW account_month_coverage SET (security_invoker = on);
ALTER VIEW project_last_contact SET (security_invoker = on);
ALTER VIEW account_people_rollup SET (security_invoker = on);
ALTER VIEW project_staleness SET (security_invoker = on);
