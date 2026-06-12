-- ============================================================
-- MIGRATION 009: Saved Views (BACKLOG #19)
--
-- Why this exists:
--   Users want to save a named filter/sort configuration on a page
--   (e.g. the Global Tracker) and reload it later — "My P0s due this week"
--   style bookmarks (spec §, backlog item 19).
--
--   A saved view is purely per-user: each user only ever sees and manages
--   their OWN views. The shape of the config is opaque JSON owned by the
--   page that created it (keyed by `page`), so we don't couple the schema
--   to any one page's filter set.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ---------- 1. saved_views table ----------
CREATE TABLE IF NOT EXISTS saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Which page/surface the view belongs to (e.g. 'tracker', 'my-tasks').
  page TEXT NOT NULL,
  name TEXT NOT NULL,
  -- Opaque filter/sort configuration owned by the page that created it.
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A user can't have two views with the same name on the same page.
  UNIQUE (user_id, page, name)
);

CREATE INDEX IF NOT EXISTS saved_views_user_page_idx
  ON saved_views(user_id, page);

-- ---------- 2. RLS: users see / manage ONLY their own views ----------
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_views_select" ON saved_views;
DROP POLICY IF EXISTS "saved_views_insert" ON saved_views;
DROP POLICY IF EXISTS "saved_views_update" ON saved_views;
DROP POLICY IF EXISTS "saved_views_delete" ON saved_views;

CREATE POLICY "saved_views_select" ON saved_views FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "saved_views_insert" ON saved_views FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "saved_views_update" ON saved_views FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "saved_views_delete" ON saved_views FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- DONE.
-- ============================================================
