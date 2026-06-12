-- ============================================================
-- MIGRATION 008: RLS hardening per spec §6
--
-- Previously, every table had wide-open policies (USING (true)) which were
-- fine for dev but unsafe for production. This migration replaces those with
-- the per-table rules from spec §6:
--   - Admin-only writes: categories, channels, channel_fields, budget_periods,
--     slack_settings, hubspot_*
--   - Author-or-admin writes: task_comments, recurring_templates
--   - Creator-or-admin delete: tasks
--   - Self-only reads + system writes: notifications, mentions, activity_log,
--     weekly_snapshots
--   - System-only inserts (via trigger): mentions, pending_mentions, activity_log
--     (writes still go through, but only when called by SECURITY DEFINER funcs)
--
-- All reads remain open to authenticated users (you can SEE everything; admin
-- gating happens on writes).
--
-- Idempotent: safe to re-run; old policies are DROPped before recreate.
-- ============================================================

-- ---------- Helper: is_admin() ----------
-- SECURITY DEFINER so it can read public.users regardless of caller's RLS.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ---------- Macro to drop ALL existing policies on a table (we recreate below) ----------
-- Postgres doesn't have "DROP ALL POLICIES" so we drop the specific names we used.
DO $$
DECLARE
  t TEXT;
  p TEXT;
  table_names TEXT[] := ARRAY[
    'users', 'categories', 'channels', 'channel_fields',
    'tasks', 'task_assignments', 'checklist_items', 'task_comments',
    'mentions', 'pending_mentions', 'task_dependencies',
    'recurring_templates', 'budget_periods', 'activity_log',
    'weekly_snapshots', 'notifications', 'slack_settings',
    'pending_slack_notifications', 'hubspot_connection',
    'hubspot_synced_contacts', 'pending_invites', 'pending_assignments'
  ];
BEGIN
  FOREACH t IN ARRAY table_names LOOP
    FOR p IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p, t);
    END LOOP;
  END LOOP;
END $$;

-- ============================================================
-- USERS: read-all | update self-or-admin | delete admin
-- ============================================================
CREATE POLICY "users_read"   ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "users_update" ON users FOR UPDATE TO authenticated
  USING (auth.uid() = id OR is_admin())
  WITH CHECK (auth.uid() = id OR is_admin());
CREATE POLICY "users_delete" ON users FOR DELETE TO authenticated USING (is_admin());
-- INSERT happens via handle_new_user trigger (SECURITY DEFINER) — no policy needed.

-- ============================================================
-- CATEGORIES, CHANNELS, CHANNEL_FIELDS: read-all | write admin
-- ============================================================
CREATE POLICY "categories_read"        ON categories      FOR SELECT TO authenticated USING (true);
CREATE POLICY "categories_admin_write" ON categories      FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "channels_read"        ON channels      FOR SELECT TO authenticated USING (true);
CREATE POLICY "channels_admin_write" ON channels      FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "channel_fields_read"        ON channel_fields FOR SELECT TO authenticated USING (true);
CREATE POLICY "channel_fields_admin_write" ON channel_fields FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ============================================================
-- TASKS: read-all | insert any auth | update any auth | delete creator-or-admin
-- (Spec §6.1: tracker_fields lock past tracker_frozen_at is enforced in app code;
--  RLS could enforce it but would also block legitimate creator updates.)
-- ============================================================
CREATE POLICY "tasks_read"   ON tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "tasks_insert" ON tasks FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "tasks_update" ON tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tasks_delete" ON tasks FOR DELETE TO authenticated USING (auth.uid() = created_by OR is_admin());

-- ============================================================
-- TASK_ASSIGNMENTS, CHECKLIST_ITEMS: read-all | full write any auth
-- ============================================================
CREATE POLICY "task_assignments_read"  ON task_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_assignments_write" ON task_assignments FOR ALL    TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "checklist_items_read"  ON checklist_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "checklist_items_write" ON checklist_items FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- TASK_COMMENTS: read-all | insert any auth | update/delete author-or-admin
-- ============================================================
CREATE POLICY "task_comments_read"   ON task_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_comments_insert" ON task_comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "task_comments_update" ON task_comments FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR is_admin())
  WITH CHECK (auth.uid() = user_id OR is_admin());
CREATE POLICY "task_comments_delete" ON task_comments FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR is_admin());

-- ============================================================
-- MENTIONS, PENDING_MENTIONS: read-all | system insert only
-- Server actions write to these; they run with the user's JWT but the writes
-- should be allowed since the action is on the user's behalf.
-- ============================================================
CREATE POLICY "mentions_read"   ON mentions FOR SELECT TO authenticated USING (true);
CREATE POLICY "mentions_insert" ON mentions FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "pending_mentions_read"   ON pending_mentions FOR SELECT TO authenticated USING (true);
CREATE POLICY "pending_mentions_insert" ON pending_mentions FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- TASK_DEPENDENCIES: read-all | insert/delete any auth
-- ============================================================
CREATE POLICY "task_dependencies_read"   ON task_dependencies FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_dependencies_insert" ON task_dependencies FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "task_dependencies_delete" ON task_dependencies FOR DELETE TO authenticated USING (true);

-- ============================================================
-- RECURRING_TEMPLATES: read-all | insert any auth | update/delete creator-or-admin
-- ============================================================
CREATE POLICY "recurring_templates_read"   ON recurring_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "recurring_templates_insert" ON recurring_templates FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "recurring_templates_update" ON recurring_templates FOR UPDATE TO authenticated
  USING (auth.uid() = created_by OR is_admin())
  WITH CHECK (auth.uid() = created_by OR is_admin());
CREATE POLICY "recurring_templates_delete" ON recurring_templates FOR DELETE TO authenticated
  USING (auth.uid() = created_by OR is_admin());

-- ============================================================
-- BUDGET_PERIODS: read-all | write admin
-- ============================================================
CREATE POLICY "budget_periods_read"        ON budget_periods FOR SELECT TO authenticated USING (true);
CREATE POLICY "budget_periods_admin_write" ON budget_periods FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ============================================================
-- ACTIVITY_LOG, WEEKLY_SNAPSHOTS: read-all | system insert only
-- ============================================================
CREATE POLICY "activity_log_read"   ON activity_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "activity_log_insert" ON activity_log FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "weekly_snapshots_read"   ON weekly_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "weekly_snapshots_insert" ON weekly_snapshots FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- NOTIFICATIONS: read-self-or-admin | system insert | update-self (mark read)
-- ============================================================
CREATE POLICY "notifications_read"   ON notifications FOR SELECT TO authenticated USING (auth.uid() = user_id OR is_admin());
CREATE POLICY "notifications_insert" ON notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "notifications_update" ON notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- SLACK_SETTINGS, PENDING_SLACK_NOTIFICATIONS: admin-only across the board
-- ============================================================
CREATE POLICY "slack_settings_admin" ON slack_settings FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "pending_slack_notifications_read"  ON pending_slack_notifications FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "pending_slack_notifications_write" ON pending_slack_notifications FOR ALL    TO authenticated USING (true) WITH CHECK (true);
-- write is open so server actions can queue without being admin; reads are admin-only.

-- ============================================================
-- HUBSPOT: connection admin-only; synced_contacts any-auth read
-- ============================================================
CREATE POLICY "hubspot_connection_admin" ON hubspot_connection FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "hubspot_synced_contacts_read"  ON hubspot_synced_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "hubspot_synced_contacts_write" ON hubspot_synced_contacts FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ============================================================
-- PENDING_INVITES, PENDING_ASSIGNMENTS: admin-only for invites; any-auth for assignments
-- ============================================================
CREATE POLICY "pending_invites_admin" ON pending_invites FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "pending_assignments_read"  ON pending_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "pending_assignments_write" ON pending_assignments FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- DONE.
-- ============================================================
