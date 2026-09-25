-- ============================================================
-- Migration 017: Hero campaigns (launches, thunderclaps, big campaigns)
-- A campaign is the "hero action item" of the week/month: it shows as a
-- banner on every dashboard, has its own tracker page, links tasks from any
-- channel, and (for thunderclaps) tracks who in the team has done their bit.
-- vertical_id NULL = company-wide. Idempotent; safe to paste on the live DB.
-- ============================================================

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_id UUID REFERENCES verticals(id) ON DELETE CASCADE,   -- NULL = workspace-wide
  kind TEXT NOT NULL DEFAULT 'campaign' CHECK (kind IN ('launch', 'thunderclap', 'campaign')),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  headline TEXT,                 -- one-line banner copy
  description TEXT,
  cta_label TEXT,
  cta_url TEXT,
  starts_on DATE,
  ends_on DATE,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'done', 'cancelled')),
  is_pinned BOOLEAN NOT NULL DEFAULT TRUE,   -- show in banners while active
  color TEXT,                                -- accent (e.g. 'violet', 'amber')
  -- thunderclap: what every participant must do (post, share, comment...)
  ask TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vertical_id, slug)
);
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_workspace_slug_uq ON campaigns(slug) WHERE vertical_id IS NULL;
CREATE INDEX IF NOT EXISTS campaigns_vertical_idx ON campaigns(vertical_id);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns(status, is_pinned);

DROP TRIGGER IF EXISTS campaigns_updated_at ON campaigns;
CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Owners of the campaign (the "champions"); by email, resolved on sign-in.
CREATE TABLE IF NOT EXISTS campaign_owners (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, email)
);
CREATE INDEX IF NOT EXISTS campaign_owners_user_idx ON campaign_owners(user_id);

-- Thunderclap participants: everyone who has to do the ask, and whether they did.
CREATE TABLE IF NOT EXISTS campaign_participants (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  done_at TIMESTAMPTZ,
  proof_url TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, email)
);
CREATE INDEX IF NOT EXISTS campaign_participants_user_idx ON campaign_participants(user_id);

-- Tasks can belong to a campaign (any channel, any vertical).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tasks_campaign_idx ON tasks(campaign_id);

-- handle_new_user: also link campaign owners / participants by email.
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

  UPDATE channel_owners  SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  UPDATE vertical_owners SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  UPDATE function_owners SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  -- NEW (017)
  UPDATE campaign_owners       SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
  UPDATE campaign_participants SET user_id = NEW.id WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;

  RETURN NEW;
END;
$$;

-- ---------- RLS ----------
-- Read: everyone. Create/edit: admin, the vertical's managers (or admin only
-- for workspace-wide), or a campaign owner. Participants can tick themselves.
CREATE OR REPLACE FUNCTION public.is_campaign_owner(c UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM campaign_owners WHERE campaign_id = c AND user_id = auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.can_manage_campaign(c UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin() OR is_service_role() OR is_campaign_owner(c)
      OR EXISTS (SELECT 1 FROM campaigns x WHERE x.id = c AND x.vertical_id IS NOT NULL AND is_vertical_owner(x.vertical_id));
$$;
GRANT EXECUTE ON FUNCTION public.is_campaign_owner(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_campaign(UUID) TO authenticated, service_role;

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaigns_read"   ON campaigns;
DROP POLICY IF EXISTS "campaigns_insert" ON campaigns;
DROP POLICY IF EXISTS "campaigns_update" ON campaigns;
DROP POLICY IF EXISTS "campaigns_delete" ON campaigns;
CREATE POLICY "campaigns_read"   ON campaigns FOR SELECT TO authenticated USING (true);
CREATE POLICY "campaigns_insert" ON campaigns FOR INSERT TO authenticated
  WITH CHECK (CASE WHEN vertical_id IS NULL THEN is_admin() ELSE can_manage_vertical(vertical_id) END);
CREATE POLICY "campaigns_update" ON campaigns FOR UPDATE TO authenticated
  USING (can_manage_campaign(id)) WITH CHECK (can_manage_campaign(id));
CREATE POLICY "campaigns_delete" ON campaigns FOR DELETE TO authenticated
  USING (is_admin() OR (vertical_id IS NOT NULL AND is_vertical_owner(vertical_id)));

ALTER TABLE campaign_owners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaign_owners_read"  ON campaign_owners;
DROP POLICY IF EXISTS "campaign_owners_write" ON campaign_owners;
CREATE POLICY "campaign_owners_read"  ON campaign_owners FOR SELECT TO authenticated USING (true);
CREATE POLICY "campaign_owners_write" ON campaign_owners FOR ALL TO authenticated
  USING (can_manage_campaign(campaign_id)) WITH CHECK (can_manage_campaign(campaign_id));

ALTER TABLE campaign_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaign_participants_read"   ON campaign_participants;
DROP POLICY IF EXISTS "campaign_participants_manage" ON campaign_participants;
DROP POLICY IF EXISTS "campaign_participants_self"   ON campaign_participants;
CREATE POLICY "campaign_participants_read"   ON campaign_participants FOR SELECT TO authenticated USING (true);
CREATE POLICY "campaign_participants_manage" ON campaign_participants FOR ALL TO authenticated
  USING (can_manage_campaign(campaign_id)) WITH CHECK (can_manage_campaign(campaign_id));
-- A participant may mark their own row done (and add proof), nothing else.
CREATE POLICY "campaign_participants_self"   ON campaign_participants FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

GRANT ALL ON campaigns, campaign_owners, campaign_participants TO authenticated, service_role;
