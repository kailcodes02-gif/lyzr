-- ============================================================
-- MIGRATION 007: Invites + Pending Assignments
--
-- Why this exists:
--   The product needs:
--   (a) Admins to invite new teammates by email before they have a Supabase
--       Auth account (sends a notification email; resolves to a real user on
--       first Google SSO sign-in).
--   (b) Tasks to be assignable to an email address before that person has
--       signed in (mirroring the existing pending_mentions pattern). On first
--       sign-in, their pending assignments auto-resolve into real
--       task_assignments rows so the user lands with their work waiting.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ---------- 1. pending_invites ----------
CREATE TABLE IF NOT EXISTS pending_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  email_sent_at TIMESTAMPTZ,
  email_send_error TEXT,
  resolved_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pending_invites_unresolved_idx
  ON pending_invites(email) WHERE resolved_user_id IS NULL;

-- ---------- 2. pending_assignments ----------
CREATE TABLE IF NOT EXISTS pending_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role assignment_role NOT NULL DEFAULT 'other',
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, email)
);

CREATE INDEX IF NOT EXISTS pending_assignments_email_idx
  ON pending_assignments(email) WHERE resolved_user_id IS NULL;

-- ---------- 3. RLS ----------
ALTER TABLE pending_invites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_assignments  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read"  ON pending_invites;
DROP POLICY IF EXISTS "auth_write" ON pending_invites;
CREATE POLICY "auth_read"  ON pending_invites FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON pending_invites FOR ALL    TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_read"  ON pending_assignments;
DROP POLICY IF EXISTS "auth_write" ON pending_assignments;
CREATE POLICY "auth_read"  ON pending_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write" ON pending_assignments FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- ---------- 4. Extend handle_new_user trigger ----------
-- The existing trigger (migration 001) creates a public.users row and resolves
-- pending_mentions. We extend it to ALSO:
--   - Mark the matching pending_invite as resolved (if any)
--   - Resolve all pending_assignments for this email into real task_assignments
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Mirror auth.users → public.users (unchanged from migration 001)
  INSERT INTO public.users (id, email, display_name, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    CASE WHEN NEW.email = 'kailash.gm@lyzr.ai' THEN 'admin'::user_role ELSE 'member'::user_role END
  );

  -- Resolve pending mentions (unchanged from migration 001)
  UPDATE pending_mentions
     SET resolved_user_id = NEW.id, resolved_at = now()
   WHERE email = NEW.email AND resolved_user_id IS NULL;

  INSERT INTO mentions (task_id, surface, surface_ref_id, mentioned_user_id, mentioned_email, mentioned_by)
  SELECT pm.task_id, pm.surface, pm.surface_ref_id, NEW.id, NEW.email, NEW.id
    FROM pending_mentions pm
   WHERE pm.email = NEW.email AND pm.resolved_user_id = NEW.id;

  -- NEW: Mark pending invite resolved
  UPDATE pending_invites
     SET resolved_user_id = NEW.id, resolved_at = now()
   WHERE email = NEW.email AND resolved_user_id IS NULL;

  -- NEW: Materialize pending_assignments into real task_assignments.
  -- ON CONFLICT DO NOTHING avoids dup-key errors if someone got assigned
  -- both by email and (race) by user_id around the same moment.
  INSERT INTO task_assignments (task_id, user_id, role, assigned_by)
  SELECT pa.task_id, NEW.id, pa.role, pa.assigned_by
    FROM pending_assignments pa
   WHERE pa.email = NEW.email AND pa.resolved_user_id IS NULL
  ON CONFLICT (task_id, user_id) DO NOTHING;

  UPDATE pending_assignments
     SET resolved_user_id = NEW.id, resolved_at = now()
   WHERE email = NEW.email AND resolved_user_id IS NULL;

  RETURN NEW;
END;
$$;

-- Trigger binding from migration 001 references this function by name, so the
-- CREATE OR REPLACE above is enough — no need to recreate the trigger itself.

-- ============================================================
-- DONE.
-- ============================================================
