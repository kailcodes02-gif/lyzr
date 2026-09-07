-- ============================================================
-- Admin role system:
--   - kailash.gm@lyzr.ai, shekar@lyzr.ai (and subs@lyzr.ai, already the
--     existing hardcoded admin) get role='admin' on sign-in; everyone
--     else defaults to 'member'.
--   - Backfilled for anyone who already has a users row.
--   - Only admins can change a user's role (promote others to admin).
--   - Task deletion is restricted to the task's creator or an admin —
--     creating tasks and checking off assigned checklist items stays
--     open to everyone (unchanged from 001's permissive insert/update).
-- Run after 001-004.
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    CASE
      WHEN NEW.email IN ('subs@lyzr.ai', 'kailash.gm@lyzr.ai', 'shekar@lyzr.ai') THEN 'admin'::user_role
      ELSE 'member'::user_role
    END
  );
  RETURN NEW;
END;
$$;

UPDATE public.users
SET role = 'admin'
WHERE email IN ('subs@lyzr.ai', 'kailash.gm@lyzr.ai', 'shekar@lyzr.ai') AND role != 'admin';

-- Only admins can update user rows (used for the "make admin" action on
-- the Users page). Read stays permissive to everyone, per 001.
CREATE POLICY "admin_update_users" ON users FOR UPDATE TO authenticated
  USING ((SELECT role FROM users WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');

-- Replace the old fully-permissive delete policy with creator-or-admin.
DROP POLICY IF EXISTS "auth_delete" ON tasks;
CREATE POLICY "delete_own_or_admin" ON tasks FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );
