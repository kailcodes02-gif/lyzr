-- ============================================================
-- Migration 010: GTM blueprint extensions
-- Adds the channel-level concepts the GSI_GTM_2 blueprint has and
-- the schema lacked: tier, goal, target, budget note, extra flags,
-- channel owners (by email, pre-sign-in), resources, learnings.
-- Idempotent: safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS),
-- matching the style of migrations 005/007/008/009.
-- ============================================================

-- ---------- 0. Priority scale P0-P4 ----------
-- The GTM board uses a five-step priority scale; 001 defined only P0-P3.
-- (PG12+: allowed in a transaction as long as the new value isn't used in the
-- same transaction — the seed script writes P4 later, over the API.)
ALTER TYPE task_priority ADD VALUE IF NOT EXISTS 'P4';

-- ---------- 1. Channel metadata columns ----------

ALTER TABLE channels ADD COLUMN IF NOT EXISTS tier TEXT
  CHECK (tier IN ('gold', 'silver', 'bronze', 'hygiene'));
ALTER TABLE channels ADD COLUMN IF NOT EXISTS goal TEXT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS target TEXT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS budget_note TEXT;
-- extra holds blueprint flags with no first-class column:
-- { num, color, opp_target, is_new, onote, platforms }
ALTER TABLE channels ADD COLUMN IF NOT EXISTS extra JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ---------- 2. Channel owners (by email, resolved on first sign-in) ----------

CREATE TABLE IF NOT EXISTS channel_owners (
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, email)
);

CREATE INDEX IF NOT EXISTS channel_owners_email_idx ON channel_owners(email);
CREATE INDEX IF NOT EXISTS channel_owners_user_idx ON channel_owners(user_id);

-- ---------- 3. Channel resources (the board's {name, url} links) ----------

CREATE TABLE IF NOT EXISTS channel_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channel_resources_channel_idx ON channel_resources(channel_id);

-- ---------- 3b. Channel targets (multiple per channel/sub-channel) ----------

CREATE TABLE IF NOT EXISTS channel_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channel_targets_channel_idx ON channel_targets(channel_id);

-- ---------- 4. Channel learnings (append-only retro notes) ----------

CREATE TABLE IF NOT EXISTS channel_learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channel_learnings_channel_idx ON channel_learnings(channel_id);

-- ---------- 5. RLS ----------
-- Posture mirrors 008: taxonomy structure (owners) is admin-write,
-- collaborative content (resources, learnings) is member-writable.

ALTER TABLE channel_owners    ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_learnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_targets   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "channel_targets_read"   ON channel_targets;
DROP POLICY IF EXISTS "channel_targets_insert" ON channel_targets;
DROP POLICY IF EXISTS "channel_targets_delete" ON channel_targets;
CREATE POLICY "channel_targets_read"   ON channel_targets FOR SELECT TO authenticated USING (true);
CREATE POLICY "channel_targets_insert" ON channel_targets FOR INSERT TO authenticated
  WITH CHECK (added_by = auth.uid() OR is_admin());
CREATE POLICY "channel_targets_delete" ON channel_targets FOR DELETE TO authenticated
  USING (added_by = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "channel_owners_read"        ON channel_owners;
DROP POLICY IF EXISTS "channel_owners_admin_write" ON channel_owners;
CREATE POLICY "channel_owners_read"        ON channel_owners FOR SELECT TO authenticated USING (true);
CREATE POLICY "channel_owners_admin_write" ON channel_owners FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "channel_resources_read"   ON channel_resources;
DROP POLICY IF EXISTS "channel_resources_insert" ON channel_resources;
DROP POLICY IF EXISTS "channel_resources_update" ON channel_resources;
DROP POLICY IF EXISTS "channel_resources_delete" ON channel_resources;
CREATE POLICY "channel_resources_read"   ON channel_resources FOR SELECT TO authenticated USING (true);
-- Pin authorship (mirrors 008's task_comments pattern): a member may only
-- insert rows attributed to themselves, so added_by can't be forged or NULLed.
CREATE POLICY "channel_resources_insert" ON channel_resources FOR INSERT TO authenticated
  WITH CHECK (added_by = auth.uid() OR is_admin());
CREATE POLICY "channel_resources_update" ON channel_resources FOR UPDATE TO authenticated
  USING (added_by = auth.uid() OR is_admin()) WITH CHECK (added_by = auth.uid() OR is_admin());
CREATE POLICY "channel_resources_delete" ON channel_resources FOR DELETE TO authenticated
  USING (added_by = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "channel_learnings_read"   ON channel_learnings;
DROP POLICY IF EXISTS "channel_learnings_insert" ON channel_learnings;
DROP POLICY IF EXISTS "channel_learnings_delete" ON channel_learnings;
CREATE POLICY "channel_learnings_read"   ON channel_learnings FOR SELECT TO authenticated USING (true);
CREATE POLICY "channel_learnings_insert" ON channel_learnings FOR INSERT TO authenticated
  WITH CHECK (added_by = auth.uid() OR is_admin());
CREATE POLICY "channel_learnings_delete" ON channel_learnings FOR DELETE TO authenticated
  USING (added_by = auth.uid() OR is_admin());

-- ---------- 6. Extend handle_new_user: resolve channel ownership ----------
-- Full body carried forward from migration 007 (users mirror, pending
-- mentions, pending invites, pending assignments) + NEW channel_owners step.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    CASE WHEN NEW.email = 'kailash.gm@lyzr.ai' THEN 'admin'::user_role ELSE 'member'::user_role END
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

  -- Materialize pending assignments. A pending 'primary' demotes to 'other'
  -- when the task already has a primary (task_assignments_primary_unique is a
  -- partial unique index that ON CONFLICT (task_id,user_id) cannot absorb) —
  -- seeded data must never be able to make sign-up itself fail.
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

  -- NEW (010): link channel ownership rows seeded by email
  UPDATE channel_owners
     SET user_id = NEW.id
   WHERE email = NEW.email AND user_id IS NULL;

  RETURN NEW;
END;
$$;
