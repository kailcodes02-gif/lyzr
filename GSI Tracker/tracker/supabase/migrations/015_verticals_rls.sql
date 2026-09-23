-- ============================================================
-- Migration 015: RLS for verticals
-- Reads stay open to every signed-in user. Structural writes move from
-- "global admin only" to "admin OR owner of that row's vertical".
-- Tasks / assignments / checklists / comments are untouched (any member).
-- Idempotent.
-- ============================================================

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE(auth.role() = 'service_role', false);
$$;

CREATE OR REPLACE FUNCTION public.is_vertical_owner(v UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM vertical_owners WHERE vertical_id = v AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_vertical(v UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin() OR is_service_role() OR (v IS NOT NULL AND is_vertical_owner(v));
$$;

CREATE OR REPLACE FUNCTION public.category_vertical(c UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vertical_id FROM categories WHERE id = c;
$$;

CREATE OR REPLACE FUNCTION public.channel_vertical(c UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vertical_id FROM channels WHERE id = c;
$$;

CREATE OR REPLACE FUNCTION public.my_vertical_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vertical_id FROM vertical_owners WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.is_service_role()        TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_vertical_owner(UUID)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_vertical(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.category_vertical(UUID)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.channel_vertical(UUID)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_vertical_ids()        TO authenticated, service_role;

-- ---------- verticals ----------
ALTER TABLE verticals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "verticals_read"   ON verticals;
DROP POLICY IF EXISTS "verticals_insert" ON verticals;
DROP POLICY IF EXISTS "verticals_update" ON verticals;
DROP POLICY IF EXISTS "verticals_delete" ON verticals;
CREATE POLICY "verticals_read"   ON verticals FOR SELECT TO authenticated USING (true);
CREATE POLICY "verticals_insert" ON verticals FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "verticals_update" ON verticals FOR UPDATE TO authenticated
  USING (can_manage_vertical(id)) WITH CHECK (can_manage_vertical(id));
CREATE POLICY "verticals_delete" ON verticals FOR DELETE TO authenticated USING (is_admin());

-- ---------- vertical_owners / functions / function_owners: admin ----------
ALTER TABLE vertical_owners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vertical_owners_read"  ON vertical_owners;
DROP POLICY IF EXISTS "vertical_owners_write" ON vertical_owners;
CREATE POLICY "vertical_owners_read"  ON vertical_owners FOR SELECT TO authenticated USING (true);
CREATE POLICY "vertical_owners_write" ON vertical_owners FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE functions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "functions_read"  ON functions;
DROP POLICY IF EXISTS "functions_write" ON functions;
CREATE POLICY "functions_read"  ON functions FOR SELECT TO authenticated USING (true);
CREATE POLICY "functions_write" ON functions FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE function_owners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "function_owners_read"  ON function_owners;
DROP POLICY IF EXISTS "function_owners_write" ON function_owners;
CREATE POLICY "function_owners_read"  ON function_owners FOR SELECT TO authenticated USING (true);
CREATE POLICY "function_owners_write" ON function_owners FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ---------- categories / channels / channel_fields: vertical managers ----------
DROP POLICY IF EXISTS "categories_admin_write" ON categories;
DROP POLICY IF EXISTS "categories_manage"      ON categories;
CREATE POLICY "categories_manage" ON categories FOR ALL TO authenticated
  USING (can_manage_vertical(vertical_id)) WITH CHECK (can_manage_vertical(vertical_id));

DROP POLICY IF EXISTS "channels_admin_write" ON channels;
DROP POLICY IF EXISTS "channels_manage"      ON channels;
CREATE POLICY "channels_manage" ON channels FOR ALL TO authenticated
  USING (can_manage_vertical(vertical_id))
  WITH CHECK (can_manage_vertical(category_vertical(category_id)));

DROP POLICY IF EXISTS "channel_fields_admin_write" ON channel_fields;
DROP POLICY IF EXISTS "channel_fields_manage"      ON channel_fields;
CREATE POLICY "channel_fields_manage" ON channel_fields FOR ALL TO authenticated
  USING (can_manage_vertical(channel_vertical(channel_id)))
  WITH CHECK (can_manage_vertical(channel_vertical(channel_id)));

-- ---------- channel owners / targets / resources / learnings ----------
DROP POLICY IF EXISTS "channel_owners_admin_write" ON channel_owners;
DROP POLICY IF EXISTS "channel_owners_manage"      ON channel_owners;
CREATE POLICY "channel_owners_manage" ON channel_owners FOR ALL TO authenticated
  USING (can_manage_vertical(channel_vertical(channel_id)))
  WITH CHECK (can_manage_vertical(channel_vertical(channel_id)));

DROP POLICY IF EXISTS "channel_targets_insert" ON channel_targets;
DROP POLICY IF EXISTS "channel_targets_delete" ON channel_targets;
CREATE POLICY "channel_targets_insert" ON channel_targets FOR INSERT TO authenticated
  WITH CHECK (added_by = auth.uid() OR can_manage_vertical(channel_vertical(channel_id)));
CREATE POLICY "channel_targets_delete" ON channel_targets FOR DELETE TO authenticated
  USING (added_by = auth.uid() OR can_manage_vertical(channel_vertical(channel_id)));

DROP POLICY IF EXISTS "channel_resources_update" ON channel_resources;
DROP POLICY IF EXISTS "channel_resources_delete" ON channel_resources;
CREATE POLICY "channel_resources_update" ON channel_resources FOR UPDATE TO authenticated
  USING (added_by = auth.uid() OR can_manage_vertical(channel_vertical(channel_id)))
  WITH CHECK (added_by = auth.uid() OR can_manage_vertical(channel_vertical(channel_id)));
CREATE POLICY "channel_resources_delete" ON channel_resources FOR DELETE TO authenticated
  USING (added_by = auth.uid() OR can_manage_vertical(channel_vertical(channel_id)));

DROP POLICY IF EXISTS "channel_learnings_delete" ON channel_learnings;
CREATE POLICY "channel_learnings_delete" ON channel_learnings FOR DELETE TO authenticated
  USING (added_by = auth.uid() OR can_manage_vertical(channel_vertical(channel_id)));

-- ---------- budget_periods: global = admin, scoped = vertical managers ----------
DROP POLICY IF EXISTS "budget_periods_admin_write" ON budget_periods;
DROP POLICY IF EXISTS "budget_periods_manage"      ON budget_periods;
CREATE POLICY "budget_periods_manage" ON budget_periods FOR ALL TO authenticated
  USING (CASE WHEN vertical_id IS NULL THEN is_admin() ELSE can_manage_vertical(vertical_id) END)
  WITH CHECK (
    CASE
      WHEN scope_type::text = 'global'   THEN is_admin()
      WHEN scope_type::text = 'vertical' THEN can_manage_vertical(scope_id)
      WHEN scope_type::text = 'category' THEN can_manage_vertical(category_vertical(scope_id))
      WHEN scope_type::text = 'channel'  THEN can_manage_vertical(channel_vertical(scope_id))
      ELSE is_admin()
    END
  );

-- ---------- vertical_resources ----------
ALTER TABLE vertical_resources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vertical_resources_read"  ON vertical_resources;
DROP POLICY IF EXISTS "vertical_resources_write" ON vertical_resources;
CREATE POLICY "vertical_resources_read"  ON vertical_resources FOR SELECT TO authenticated USING (true);
CREATE POLICY "vertical_resources_write" ON vertical_resources FOR ALL TO authenticated
  USING (can_manage_vertical(vertical_id)) WITH CHECK (can_manage_vertical(vertical_id));

-- ---------- slack_settings: vertical managers too ----------
DROP POLICY IF EXISTS "slack_settings_admin"  ON slack_settings;
DROP POLICY IF EXISTS "slack_settings_manage" ON slack_settings;
CREATE POLICY "slack_settings_manage" ON slack_settings FOR ALL TO authenticated
  USING (is_admin() OR can_manage_vertical(vertical_id))
  WITH CHECK (is_admin() OR can_manage_vertical(vertical_id));
