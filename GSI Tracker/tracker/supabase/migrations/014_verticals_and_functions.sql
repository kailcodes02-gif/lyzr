-- ============================================================
-- Migration 014: Verticals + Functions
-- Turns the single-business-unit GSI tracker into a multi-vertical
-- workspace ("Lyzr Marketing Tracker"):
--   verticals            top level above categories (GSI, Emerging Partners,
--                        per-product verticals, and "Lyzr" company-wide)
--   vertical_owners      who manages a vertical (by email, resolved on sign-in)
--   functions            workspace-wide channel functions (Content, Social...)
--                        so the same function rolls up across verticals
--   function_owners      default owners inherited by every vertical's instance
--   vertical_resources   per-vertical link groups (replaces hardcoded page)
-- Categories get vertical_id; channels get a denormalised vertical_id (kept
-- in sync by trigger) and function_id. Budgets/reports/snapshots/saved views
-- are scoped by vertical. Idempotent; paste into the SQL Editor or replay via
-- RESET_ALL.sql.
--
-- ENUM GOTCHA: budget_scope_type gains 'vertical' below. Nothing in THIS file
-- may reference that literal (PG forbids using a new enum value in the same
-- transaction). Triggers compare scope_type::text instead.
-- ============================================================

-- ---------- 1. verticals ----------
CREATE TABLE IF NOT EXISTS verticals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  color TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- feature flags: {leads_pipeline, weekly_report_builder, resources, hubspot_contacts}
  settings JSONB NOT NULL DEFAULT '{"leads_pipeline":false,"weekly_report_builder":false,"resources":false,"hubspot_contacts":false}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS verticals_updated_at ON verticals;
CREATE TRIGGER verticals_updated_at BEFORE UPDATE ON verticals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------- 2. vertical owners (mirror of channel_owners) ----------
CREATE TABLE IF NOT EXISTS vertical_owners (
  vertical_id UUID NOT NULL REFERENCES verticals(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vertical_id, email)
);
CREATE INDEX IF NOT EXISTS vertical_owners_email_idx ON vertical_owners(email);
CREATE INDEX IF NOT EXISTS vertical_owners_user_idx  ON vertical_owners(user_id);

-- ---------- 3. functions + function owners ----------
CREATE TABLE IF NOT EXISTS functions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS function_owners (
  function_id UUID NOT NULL REFERENCES functions(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (function_id, email)
);
CREATE INDEX IF NOT EXISTS function_owners_email_idx ON function_owners(email);
CREATE INDEX IF NOT EXISTS function_owners_user_idx  ON function_owners(user_id);

INSERT INTO functions (name, slug, icon, sort_order) VALUES
  ('Paid',         'paid',         'zap',        1),
  ('Outbound',     'outbound',     'send',       2),
  ('Content',      'content',      'file-text',  3),
  ('Social',       'social',       'share-2',    4),
  ('Events',       'events',       'calendar',   5),
  ('Community',    'community',    'users',      6),
  ('Partnerships', 'partnerships', 'handshake',  7),
  ('ABM',          'abm',          'target',     8),
  ('BTL',          'btl',          'megaphone',  9),
  ('Referrals',    'referrals',    'gift',      10),
  ('Website',      'website',      'globe',     11),
  ('Analyst / PR', 'analyst-pr',   'newspaper', 12)
ON CONFLICT (slug) DO NOTHING;

-- ---------- 4. categories -> vertical; slug unique PER vertical ----------
ALTER TABLE categories ADD COLUMN IF NOT EXISTS vertical_id UUID REFERENCES verticals(id) ON DELETE RESTRICT;
-- Live-DB safety (no-op on a fresh reset): park orphans in a GSI vertical.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM categories WHERE vertical_id IS NULL) THEN
    INSERT INTO verticals (name, slug, sort_order, settings)
    VALUES ('GSI', 'gsi', 1, '{"leads_pipeline":true,"weekly_report_builder":true,"resources":true,"hubspot_contacts":true}'::jsonb)
    ON CONFLICT (slug) DO NOTHING;
    UPDATE categories SET vertical_id = (SELECT id FROM verticals WHERE slug = 'gsi') WHERE vertical_id IS NULL;
  END IF;
END $$;
ALTER TABLE categories ALTER COLUMN vertical_id SET NOT NULL;
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS categories_vertical_slug_uq ON categories(vertical_id, slug);
CREATE INDEX IF NOT EXISTS categories_vertical_idx ON categories(vertical_id);

-- ---------- 5. channels -> vertical (denormalised) + function ----------
ALTER TABLE channels ADD COLUMN IF NOT EXISTS vertical_id UUID REFERENCES verticals(id) ON DELETE RESTRICT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS function_id UUID REFERENCES functions(id) ON DELETE SET NULL;
UPDATE channels ch SET vertical_id = c.vertical_id
  FROM categories c WHERE c.id = ch.category_id AND ch.vertical_id IS NULL;
ALTER TABLE channels ALTER COLUMN vertical_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS channels_vertical_idx ON channels(vertical_id);
CREATE INDEX IF NOT EXISTS channels_function_idx ON channels(function_id);

-- Close the NULL-parent hole: UNIQUE(category_id, parent_channel_id, slug)
-- treats NULL parents as distinct, so two top-level channels could share a
-- slug in one category. Replace with a COALESCE'd unique index.
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_category_id_parent_channel_id_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS channels_slug_uq
  ON channels (category_id, COALESCE(parent_channel_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

-- Keep channels.vertical_id honest and forbid a parent in another category.
CREATE OR REPLACE FUNCTION channels_sync_vertical()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE cat_v UUID; par_cat UUID; par_fn UUID;
BEGIN
  SELECT vertical_id INTO cat_v FROM categories WHERE id = NEW.category_id;
  IF cat_v IS NULL THEN
    RAISE EXCEPTION 'category % not found', NEW.category_id;
  END IF;
  NEW.vertical_id := cat_v;
  IF NEW.parent_channel_id IS NOT NULL THEN
    SELECT category_id, function_id INTO par_cat, par_fn FROM channels WHERE id = NEW.parent_channel_id;
    IF par_cat IS DISTINCT FROM NEW.category_id THEN
      RAISE EXCEPTION 'parent channel % is in a different category', NEW.parent_channel_id;
    END IF;
    -- Sub-channels inherit the parent's function unless set explicitly.
    IF NEW.function_id IS NULL THEN NEW.function_id := par_fn; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS channels_sync_vertical_trg ON channels;
CREATE TRIGGER channels_sync_vertical_trg
  BEFORE INSERT OR UPDATE OF category_id, parent_channel_id, function_id ON channels
  FOR EACH ROW EXECUTE FUNCTION channels_sync_vertical();

-- A category cannot move between verticals once it has channels.
CREATE OR REPLACE FUNCTION categories_guard_vertical_move()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.vertical_id IS DISTINCT FROM OLD.vertical_id
     AND EXISTS (SELECT 1 FROM channels WHERE category_id = NEW.id) THEN
    RAISE EXCEPTION 'category % has channels; it cannot move to another vertical', NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS categories_guard_vertical_move_trg ON categories;
CREATE TRIGGER categories_guard_vertical_move_trg
  BEFORE UPDATE OF vertical_id ON categories
  FOR EACH ROW EXECUTE FUNCTION categories_guard_vertical_move();

-- ---------- 6. vertical resources ----------
CREATE TABLE IF NOT EXISTS vertical_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_id UUID NOT NULL REFERENCES verticals(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vertical_resources_vertical_idx ON vertical_resources(vertical_id);

-- ---------- 7. vertical scope on budgets / reports / snapshots / views ----------
ALTER TYPE budget_scope_type ADD VALUE IF NOT EXISTS 'vertical';

ALTER TABLE budget_periods    ADD COLUMN IF NOT EXISTS vertical_id UUID REFERENCES verticals(id) ON DELETE CASCADE; -- NULL = workspace/global
ALTER TABLE weekly_reports    ADD COLUMN IF NOT EXISTS vertical_id UUID REFERENCES verticals(id) ON DELETE CASCADE;
ALTER TABLE report_ad_spend   ADD COLUMN IF NOT EXISTS vertical_id UUID REFERENCES verticals(id) ON DELETE CASCADE;
ALTER TABLE report_done_items ADD COLUMN IF NOT EXISTS vertical_id UUID REFERENCES verticals(id) ON DELETE CASCADE;
ALTER TABLE weekly_snapshots  ADD COLUMN IF NOT EXISTS vertical_id UUID REFERENCES verticals(id) ON DELETE CASCADE;
ALTER TABLE saved_views       ADD COLUMN IF NOT EXISTS vertical_id UUID REFERENCES verticals(id) ON DELETE CASCADE;
ALTER TABLE slack_settings    ADD COLUMN IF NOT EXISTS vertical_id UUID REFERENCES verticals(id) ON DELETE CASCADE;

-- Reports and snapshots are always per vertical (the "Lyzr" vertical is the
-- company-wide scope). Backfill orphans into GSI, then require it.
DO $$
DECLARE gsi UUID;
BEGIN
  SELECT id INTO gsi FROM verticals WHERE slug = 'gsi';
  IF gsi IS NOT NULL THEN
    UPDATE weekly_reports    SET vertical_id = gsi WHERE vertical_id IS NULL;
    UPDATE report_ad_spend   SET vertical_id = gsi WHERE vertical_id IS NULL;
    UPDATE report_done_items SET vertical_id = gsi WHERE vertical_id IS NULL;
    UPDATE weekly_snapshots  SET vertical_id = gsi WHERE vertical_id IS NULL;
  END IF;
  -- On a fresh reset these tables are empty, so NOT NULL is safe either way.
  IF NOT EXISTS (SELECT 1 FROM weekly_reports WHERE vertical_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM report_ad_spend WHERE vertical_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM report_done_items WHERE vertical_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM weekly_snapshots WHERE vertical_id IS NULL) THEN
    ALTER TABLE weekly_reports    ALTER COLUMN vertical_id SET NOT NULL;
    ALTER TABLE report_ad_spend   ALTER COLUMN vertical_id SET NOT NULL;
    ALTER TABLE report_done_items ALTER COLUMN vertical_id SET NOT NULL;
    ALTER TABLE weekly_snapshots  ALTER COLUMN vertical_id SET NOT NULL;
  END IF;
END $$;

ALTER TABLE weekly_reports   DROP CONSTRAINT IF EXISTS weekly_reports_week_starting_week_ending_key;
ALTER TABLE weekly_reports   DROP CONSTRAINT IF EXISTS weekly_reports_vertical_week_uq;
ALTER TABLE weekly_reports   ADD  CONSTRAINT weekly_reports_vertical_week_uq UNIQUE (vertical_id, week_starting, week_ending);

ALTER TABLE weekly_snapshots DROP CONSTRAINT IF EXISTS weekly_snapshots_week_starting_key;
ALTER TABLE weekly_snapshots DROP CONSTRAINT IF EXISTS weekly_snapshots_vertical_week_uq;
ALTER TABLE weekly_snapshots ADD  CONSTRAINT weekly_snapshots_vertical_week_uq UNIQUE (vertical_id, week_starting);

-- Saved views: NULL vertical = a workspace-level ("all verticals") view.
ALTER TABLE saved_views DROP CONSTRAINT IF EXISTS saved_views_user_id_page_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS saved_views_uq
  ON saved_views (user_id, page, COALESCE(vertical_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

CREATE INDEX IF NOT EXISTS report_ad_spend_vertical_week_idx   ON report_ad_spend(vertical_id, week_starting);
CREATE INDEX IF NOT EXISTS report_done_items_vertical_week_idx ON report_done_items(vertical_id, week_starting);
CREATE INDEX IF NOT EXISTS budget_periods_vertical_idx         ON budget_periods(vertical_id);

-- budget_periods.vertical_id derived from the scope (global = NULL).
CREATE OR REPLACE FUNCTION budget_periods_sync_vertical()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scope_type::text = 'vertical' THEN
    NEW.vertical_id := NEW.scope_id;
  ELSIF NEW.scope_type::text = 'category' THEN
    SELECT vertical_id INTO NEW.vertical_id FROM categories WHERE id = NEW.scope_id;
  ELSIF NEW.scope_type::text = 'channel' THEN
    SELECT vertical_id INTO NEW.vertical_id FROM channels WHERE id = NEW.scope_id;
  ELSE
    NEW.vertical_id := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS budget_periods_sync_vertical_trg ON budget_periods;
CREATE TRIGGER budget_periods_sync_vertical_trg BEFORE INSERT OR UPDATE ON budget_periods
  FOR EACH ROW EXECUTE FUNCTION budget_periods_sync_vertical();

-- Backfill vertical_id on existing budget rows (no-op on fresh reset).
UPDATE budget_periods bp SET vertical_id = c.vertical_id
  FROM categories c WHERE bp.scope_type::text = 'category' AND c.id = bp.scope_id AND bp.vertical_id IS NULL;
UPDATE budget_periods bp SET vertical_id = ch.vertical_id
  FROM channels ch WHERE bp.scope_type::text = 'channel' AND ch.id = bp.scope_id AND bp.vertical_id IS NULL;

-- budget_period_summary gains vertical_id (same leading columns, so REPLACE works).
CREATE OR REPLACE VIEW budget_period_summary AS
SELECT
  bp.id AS budget_period_id,
  bp.period_label,
  bp.scope_type,
  bp.scope_id,
  bp.total_budget,
  COALESCE(SUM(t.budget_allocated), 0) AS allocated,
  bp.total_budget - COALESCE(SUM(t.budget_allocated), 0) AS remaining,
  COUNT(t.id) FILTER (WHERE t.budget_allocated IS NOT NULL) AS task_count,
  bp.vertical_id
FROM budget_periods bp
LEFT JOIN tasks t ON t.budget_period_id = bp.id
GROUP BY bp.id;

-- ---------- 8. effective channel owners ----------
-- Explicit channel_owners rows win; otherwise the channel inherits the
-- owners of its function. Sub-channels with no rows of their own fall back
-- to their parent channel's rows before the function.
CREATE OR REPLACE VIEW effective_channel_owners AS
SELECT ch.id AS channel_id, co.email, co.user_id, co.sort_order, 'channel'::text AS source
  FROM channels ch
  JOIN channel_owners co ON co.channel_id = ch.id
UNION ALL
SELECT ch.id, pco.email, pco.user_id, pco.sort_order, 'parent'::text
  FROM channels ch
  JOIN channel_owners pco ON pco.channel_id = ch.parent_channel_id
 WHERE NOT EXISTS (SELECT 1 FROM channel_owners x WHERE x.channel_id = ch.id)
UNION ALL
SELECT ch.id, fo.email, fo.user_id, fo.sort_order, 'function'::text
  FROM channels ch
  JOIN function_owners fo ON fo.function_id = ch.function_id
 WHERE NOT EXISTS (SELECT 1 FROM channel_owners x WHERE x.channel_id = ch.id)
   AND NOT EXISTS (SELECT 1 FROM channel_owners p WHERE p.channel_id = ch.parent_channel_id);

-- ---------- 9. handle_new_user: full 010 body + vertical/function owner linking ----------
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

  UPDATE channel_owners
     SET user_id = NEW.id
   WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;

  -- NEW (014): vertical + function ownership seeded by email
  UPDATE vertical_owners
     SET user_id = NEW.id
   WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;

  UPDATE function_owners
     SET user_id = NEW.id
   WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;

  RETURN NEW;
END;
$$;

-- ---------- 10. grants ----------
GRANT ALL ON verticals, vertical_owners, functions, function_owners, vertical_resources TO authenticated, service_role;
GRANT SELECT ON effective_channel_owners, budget_period_summary TO authenticated, service_role;
