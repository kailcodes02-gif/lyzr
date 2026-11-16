-- ============================================================
-- Migration 037 — guest logins
-- A short, admin-managed list of non-Lyzr emails that may hold a tracker
-- account (they sign in with email + password). Everyone else must still
-- be @lyzr.com. Safe to run more than once.
-- ============================================================
CREATE TABLE IF NOT EXISTS guest_emails (
  email      TEXT PRIMARY KEY,
  note       TEXT,
  added_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE guest_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guest_emails_read ON guest_emails;
CREATE POLICY guest_emails_read ON guest_emails FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS guest_emails_manage ON guest_emails;
CREATE POLICY guest_emails_manage ON guest_emails FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

INSERT INTO guest_emails (email, note) VALUES ('isha@whitepath.in', 'Whitepath') ON CONFLICT DO NOTHING;

-- Sign-up guard: @lyzr.com, or an email on the guest list.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  em TEXT := lower(NEW.email); twin TEXT := lyzr_twin(NEW.email); md JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb); nm TEXT; av TEXT; existing TEXT;
BEGIN
  IF em IS NULL OR NOT (em LIKE '%@lyzr.com' OR EXISTS (SELECT 1 FROM guest_emails g WHERE lower(g.email) = em)) THEN
    RAISE EXCEPTION 'Only lyzr.com Microsoft accounts can sign in to the tracker (%)', em USING ERRCODE = '42501';
  END IF;
  SELECT email INTO existing FROM public.users WHERE lower(email) = twin OR lower(alt_email) = em LIMIT 1;
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'You already have a tracker account as %. Ask an admin to move it to your lyzr.com address.', existing USING ERRCODE = '42501';
  END IF;
  nm := COALESCE(NULLIF(md->>'full_name', ''), NULLIF(md->>'name', ''), NULLIF(md->>'preferred_username', ''), split_part(em, '@', 1));
  av := COALESCE(NULLIF(md->>'avatar_url', ''), NULLIF(md->>'picture', ''));
  INSERT INTO public.users (id, email, display_name, avatar_url, role)
  VALUES (NEW.id, NEW.email, nm, av, CASE WHEN EXISTS (SELECT 1 FROM admin_emails a WHERE lower(a.email) IN (em, twin)) THEN 'admin'::user_role ELSE 'member'::user_role END);
  UPDATE pending_mentions SET resolved_user_id = NEW.id, resolved_at = now() WHERE lower(email) IN (em, twin) AND resolved_user_id IS NULL;
  INSERT INTO mentions (task_id, surface, surface_ref_id, mentioned_user_id, mentioned_email, mentioned_by)
  SELECT pm.task_id, pm.surface, pm.surface_ref_id, NEW.id, NEW.email, NEW.id FROM pending_mentions pm WHERE lower(pm.email) IN (em, twin) AND pm.resolved_user_id = NEW.id;
  UPDATE pending_invites SET resolved_user_id = NEW.id, resolved_at = now() WHERE lower(email) IN (em, twin) AND resolved_user_id IS NULL;
  INSERT INTO task_assignments (task_id, user_id, role, assigned_by)
  SELECT pa.task_id, NEW.id, CASE WHEN pa.role = 'primary' AND EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = pa.task_id AND ta.role = 'primary') THEN 'secondary'::assignment_role ELSE pa.role END, pa.assigned_by
    FROM pending_assignments pa WHERE lower(pa.email) IN (em, twin) AND pa.resolved_user_id IS NULL ON CONFLICT (task_id, user_id) DO NOTHING;
  UPDATE pending_assignments SET resolved_user_id = NEW.id, resolved_at = now() WHERE lower(email) IN (em, twin) AND resolved_user_id IS NULL;
  UPDATE channel_owners SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE vertical_owners SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE vertical_members SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE function_owners SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE campaign_owners SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE campaign_participants SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  RETURN NEW;
END; $$;

SELECT email, note FROM guest_emails;
