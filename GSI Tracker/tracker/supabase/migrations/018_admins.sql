-- ============================================================
-- Migration 018: admin list (per Kailash, 2026-09-25)
-- Admins are decided by email so the role survives a reset and applies on
-- first sign-in. Idempotent; safe to paste on the live DB.
-- Note: sign-in is Google SSO restricted to @lyzr.ai; the @lyzr.com twins are
-- listed so they become admin if that domain is ever allowed.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_emails (
  email TEXT PRIMARY KEY,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO admin_emails (email) VALUES
  ('kailash.gm@lyzr.ai'), ('kailash.gm@lyzr.com'),
  ('ani@lyzr.ai'), ('ani@lyzr.com'),
  ('mothilal.kanagaraj@lyzr.ai'), ('mothilal.kanagaraj@lyzr.com')
ON CONFLICT (email) DO NOTHING;

ALTER TABLE admin_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_emails_read" ON admin_emails;
DROP POLICY IF EXISTS "admin_emails_write" ON admin_emails;
CREATE POLICY "admin_emails_read"  ON admin_emails FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_emails_write" ON admin_emails FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
GRANT ALL ON admin_emails TO authenticated, service_role;

-- Promote anyone already signed in.
UPDATE users SET role = 'admin'::user_role
 WHERE lower(email) IN (SELECT lower(email) FROM admin_emails) AND role <> 'admin';

-- handle_new_user: role comes from admin_emails instead of one hard-coded address.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    CASE WHEN EXISTS (SELECT 1 FROM admin_emails a WHERE lower(a.email) = lower(NEW.email))
         THEN 'admin'::user_role ELSE 'member'::user_role END
  );

  UPDATE pending_mentions
     SET resolved_user_id = NEW.id, resolved_at = now()
   WHERE email = NEW.email AND resolved_user_id IS NULL;

  INSERT INTO mentions (task_id, surface, surface_ref_id, mentioned_user_id, mentioned_email, mentioned_by)
  SELECT pm.task_id, pm.surface, pm.surface_ref_id, NEW.id, NEW.email, NEW.id
    FROM pending_mentions pm
   WHERE pm.email = NEW.email AND pm.resolved_user_id = NEW.id;

  UPDATE pending_invites
     SET resolved_user_id = NEW.id, resolved_at = now()
   WHERE email = NEW.email AND resolved_user_id IS NULL;

  INSERT INTO task_assignments (task_id, user_id, role, assigned_by)
  SELECT pa.task_id, NEW.id,
         CASE
           WHEN pa.role = 'primary' AND EXISTS (
             SELECT 1 FROM task_assignments ta
              WHERE ta.task_id = pa.task_id AND ta.role = 'primary'
           ) THEN 'secondary'::assignment_role
           ELSE pa.role
         END,
         pa.assigned_by
    FROM pending_assignments pa
   WHERE pa.email = NEW.email AND pa.resolved_user_id IS NULL
  ON CONFLICT (task_id, user_id) DO NOTHING;

  UPDATE pending_assignments
     SET resolved_user_id = NEW.id, resolved_at = now()
   WHERE email = NEW.email AND resolved_user_id IS NULL;

  UPDATE channel_owners        SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  UPDATE vertical_owners       SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  UPDATE function_owners       SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  UPDATE campaign_owners       SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  UPDATE campaign_participants SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;

  RETURN NEW;
END;
$$;
