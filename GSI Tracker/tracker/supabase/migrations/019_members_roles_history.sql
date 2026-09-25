-- ============================================================
-- Migration 019: members, leadership badge, owner-scoped rights,
-- task edit history, suggested edits, cross-channel sub-tasks.
-- Per Kailash 2026-09-25:
--   * anyone who is a member of a vertical can create tasks / sub-tasks there
--   * vertical owners create channels; a channel owner may add sub-channels
--     under their own channel and set owners below them
--   * task owners (and admins / vertical owners / channel owners) edit and
--     delete; everyone else suggests an edit the owner accepts or rejects
--   * every field change on a task is recorded (DB trigger, not client)
--   * Leadership = read-across badge, no edit rights by itself
-- Idempotent; safe to paste on the live DB.
-- ============================================================

-- ---------- badges ----------
CREATE TABLE IF NOT EXISTS leadership_emails (
  email TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE leadership_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leadership_emails_read"  ON leadership_emails;
DROP POLICY IF EXISTS "leadership_emails_write" ON leadership_emails;
CREATE POLICY "leadership_emails_read"  ON leadership_emails FOR SELECT TO authenticated USING (true);
CREATE POLICY "leadership_emails_write" ON leadership_emails FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
GRANT ALL ON leadership_emails TO authenticated, service_role;
-- Admins are leadership by default.
INSERT INTO leadership_emails (email) SELECT email FROM admin_emails ON CONFLICT DO NOTHING;

-- ---------- vertical members ----------
CREATE TABLE IF NOT EXISTS vertical_members (
  vertical_id UUID NOT NULL REFERENCES verticals(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vertical_id, email)
);
CREATE INDEX IF NOT EXISTS vertical_members_user_idx ON vertical_members(user_id);
UPDATE vertical_members m SET user_id = u.id FROM users u WHERE m.user_id IS NULL AND lower(u.email) = lower(m.email);

-- Everyone who owns something in a vertical is a member of it, plus explicit rows.
CREATE OR REPLACE FUNCTION public.is_vertical_member(v UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v IS NOT NULL AND (
    is_admin() OR is_service_role() OR is_vertical_owner(v)
    OR EXISTS (SELECT 1 FROM vertical_members WHERE vertical_id = v AND user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM channel_owners o JOIN channels c ON c.id = o.channel_id WHERE c.vertical_id = v AND o.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM function_owners f JOIN channels c ON c.function_id = f.function_id WHERE c.vertical_id = v AND f.user_id = auth.uid())
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_vertical_member(UUID) TO authenticated, service_role;

ALTER TABLE vertical_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vertical_members_read"   ON vertical_members;
DROP POLICY IF EXISTS "vertical_members_manage" ON vertical_members;
CREATE POLICY "vertical_members_read"   ON vertical_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "vertical_members_manage" ON vertical_members FOR ALL TO authenticated
  USING (can_manage_vertical(vertical_id)) WITH CHECK (can_manage_vertical(vertical_id));
GRANT ALL ON vertical_members TO authenticated, service_role;

-- ---------- channel-owner scoped rights ----------
-- True when the caller owns channel c, its parent, or its grandparent.
CREATE OR REPLACE FUNCTION public.owns_channel_or_ancestor(c UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE up AS (
    SELECT id, parent_channel_id, 0 AS depth FROM channels WHERE id = c
    UNION ALL
    SELECT ch.id, ch.parent_channel_id, up.depth + 1 FROM channels ch JOIN up ON ch.id = up.parent_channel_id WHERE up.depth < 4
  )
  SELECT EXISTS (SELECT 1 FROM channel_owners o JOIN up ON up.id = o.channel_id WHERE o.user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.owns_channel_or_ancestor(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "channels_manage" ON channels;
DROP POLICY IF EXISTS "channels_insert" ON channels;
DROP POLICY IF EXISTS "channels_update" ON channels;
DROP POLICY IF EXISTS "channels_delete" ON channels;
CREATE POLICY "channels_insert" ON channels FOR INSERT TO authenticated
  WITH CHECK (can_manage_vertical(category_vertical(category_id))
           OR (parent_channel_id IS NOT NULL AND owns_channel_or_ancestor(parent_channel_id)));
CREATE POLICY "channels_update" ON channels FOR UPDATE TO authenticated
  USING (can_manage_vertical(vertical_id) OR owns_channel_or_ancestor(id))
  WITH CHECK (can_manage_vertical(vertical_id) OR owns_channel_or_ancestor(id));
CREATE POLICY "channels_delete" ON channels FOR DELETE TO authenticated
  USING (can_manage_vertical(vertical_id));

DROP POLICY IF EXISTS "channel_owners_manage" ON channel_owners;
CREATE POLICY "channel_owners_manage" ON channel_owners FOR ALL TO authenticated
  USING (can_manage_vertical(channel_vertical(channel_id)) OR owns_channel_or_ancestor(channel_id))
  WITH CHECK (can_manage_vertical(channel_vertical(channel_id)) OR owns_channel_or_ancestor(channel_id));

-- ---------- tasks: members create, owners edit/delete ----------
CREATE OR REPLACE FUNCTION public.is_task_owner(t UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM task_assignments WHERE task_id = t AND user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM tasks WHERE id = t AND created_by = auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.can_edit_task(t UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin() OR is_service_role() OR is_task_owner(t)
      OR EXISTS (SELECT 1 FROM tasks x WHERE x.id = t AND (is_vertical_owner(channel_vertical(x.channel_id)) OR owns_channel_or_ancestor(x.channel_id)))
      -- owners of the parent activity may edit its sub-tasks
      OR EXISTS (SELECT 1 FROM tasks x WHERE x.id = t AND x.parent_task_id IS NOT NULL AND is_task_owner(x.parent_task_id));
$$;
GRANT EXECUTE ON FUNCTION public.is_task_owner(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_task(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS "tasks_insert" ON tasks;
DROP POLICY IF EXISTS "tasks_update" ON tasks;
DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND is_vertical_member(channel_vertical(channel_id)));
CREATE POLICY "tasks_update" ON tasks FOR UPDATE TO authenticated
  USING (can_edit_task(id)) WITH CHECK (can_edit_task(id));
CREATE POLICY "tasks_delete" ON tasks FOR DELETE TO authenticated
  USING (can_edit_task(id));

-- Assignments: whoever may edit the task may change its owners; creating a
-- task inserts its own assignments (creator is owner via created_by).
DROP POLICY IF EXISTS "task_assignments_write" ON task_assignments;
CREATE POLICY "task_assignments_write" ON task_assignments FOR ALL TO authenticated
  USING (can_edit_task(task_id)) WITH CHECK (can_edit_task(task_id));

-- ---------- task history (trigger-written) ----------
CREATE OR REPLACE FUNCTION public.log_task_edit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f TEXT;
  fields TEXT[] := ARRAY['title','description','priority','status','due_date','channel_id','parent_task_id',
                         'budget_allocated','budget_period_id','campaign_id','result_url','blocked_reason','blocked_by_email',
                         'planning_fields','tracker_fields'];
  o JSONB := to_jsonb(OLD);
  n JSONB := to_jsonb(NEW);
BEGIN
  FOREACH f IN ARRAY fields LOOP
    IF (o -> f) IS DISTINCT FROM (n -> f) THEN
      -- status changes are already logged by the client as 'status_changed'
      IF f = 'status' THEN CONTINUE; END IF;
      INSERT INTO activity_log (task_id, actor_id, action, from_value, to_value)
      VALUES (NEW.id, auth.uid(), 'edited', jsonb_build_object('field', f, 'value', o -> f), jsonb_build_object('field', f, 'value', n -> f));
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tasks_log_edit ON tasks;
CREATE TRIGGER tasks_log_edit AFTER UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION log_task_edit();

-- ---------- suggested edits ----------
CREATE TABLE IF NOT EXISTS task_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  suggested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patch JSONB NOT NULL,            -- { field: value, ... } same keys updateTask accepts
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_suggestions_task_idx ON task_suggestions(task_id, status);
ALTER TABLE task_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_suggestions_read"    ON task_suggestions;
DROP POLICY IF EXISTS "task_suggestions_insert"  ON task_suggestions;
DROP POLICY IF EXISTS "task_suggestions_resolve" ON task_suggestions;
DROP POLICY IF EXISTS "task_suggestions_delete"  ON task_suggestions;
CREATE POLICY "task_suggestions_read"    ON task_suggestions FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_suggestions_insert"  ON task_suggestions FOR INSERT TO authenticated WITH CHECK (suggested_by = auth.uid());
CREATE POLICY "task_suggestions_resolve" ON task_suggestions FOR UPDATE TO authenticated
  USING (can_edit_task(task_id)) WITH CHECK (can_edit_task(task_id));
CREATE POLICY "task_suggestions_delete"  ON task_suggestions FOR DELETE TO authenticated
  USING (suggested_by = auth.uid() OR can_edit_task(task_id));
GRANT ALL ON task_suggestions TO authenticated, service_role;

-- ---------- handle_new_user: link vertical_members ----------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url, role)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    CASE WHEN EXISTS (SELECT 1 FROM admin_emails a WHERE lower(a.email) = lower(NEW.email))
         THEN 'admin'::user_role ELSE 'member'::user_role END
  );
  UPDATE pending_mentions SET resolved_user_id = NEW.id, resolved_at = now() WHERE email = NEW.email AND resolved_user_id IS NULL;
  INSERT INTO mentions (task_id, surface, surface_ref_id, mentioned_user_id, mentioned_email, mentioned_by)
  SELECT pm.task_id, pm.surface, pm.surface_ref_id, NEW.id, NEW.email, NEW.id FROM pending_mentions pm
   WHERE pm.email = NEW.email AND pm.resolved_user_id = NEW.id;
  UPDATE pending_invites SET resolved_user_id = NEW.id, resolved_at = now() WHERE email = NEW.email AND resolved_user_id IS NULL;
  INSERT INTO task_assignments (task_id, user_id, role, assigned_by)
  SELECT pa.task_id, NEW.id,
         CASE WHEN pa.role = 'primary' AND EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = pa.task_id AND ta.role = 'primary')
              THEN 'secondary'::assignment_role ELSE pa.role END,
         pa.assigned_by
    FROM pending_assignments pa WHERE pa.email = NEW.email AND pa.resolved_user_id IS NULL
  ON CONFLICT (task_id, user_id) DO NOTHING;
  UPDATE pending_assignments SET resolved_user_id = NEW.id, resolved_at = now() WHERE email = NEW.email AND resolved_user_id IS NULL;
  UPDATE channel_owners        SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  UPDATE vertical_owners       SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  UPDATE vertical_members      SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  UPDATE function_owners       SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  UPDATE campaign_owners       SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  UPDATE campaign_participants SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  RETURN NEW;
END;
$$;

-- Everyone who already signed in is a member of every vertical, so nobody
-- is locked out of creating tasks on cutover day. Trim from Members later.
INSERT INTO vertical_members (vertical_id, email, user_id)
SELECT v.id, u.email, u.id FROM verticals v CROSS JOIN users u
WHERE u.email <> 'preview@lyzr.ai'
ON CONFLICT DO NOTHING;
