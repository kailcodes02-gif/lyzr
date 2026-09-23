-- ============================================================
-- Migration 016: Taxonomy templates + vertical RPCs
-- A template is a JSON snapshot of a vertical's taxonomy (categories ->
-- channels -> sub-channels, with function links and custom fields, but NO
-- ids, owners, activities or budgets). New verticals can be cloned from one.
-- RPCs run SECURITY DEFINER so the clone is atomic and does not depend on
-- per-row RLS checks; each guards with can_manage_vertical / is_admin.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS taxonomy_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  body JSONB NOT NULL,
  source_vertical_id UUID REFERENCES verticals(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS taxonomy_templates_updated_at ON taxonomy_templates;
CREATE TRIGGER taxonomy_templates_updated_at BEFORE UPDATE ON taxonomy_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE taxonomy_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "taxonomy_templates_read"   ON taxonomy_templates;
DROP POLICY IF EXISTS "taxonomy_templates_insert" ON taxonomy_templates;
DROP POLICY IF EXISTS "taxonomy_templates_update" ON taxonomy_templates;
DROP POLICY IF EXISTS "taxonomy_templates_delete" ON taxonomy_templates;
CREATE POLICY "taxonomy_templates_read"   ON taxonomy_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "taxonomy_templates_insert" ON taxonomy_templates FOR INSERT TO authenticated
  WITH CHECK (is_admin() OR (source_vertical_id IS NOT NULL AND can_manage_vertical(source_vertical_id)));
CREATE POLICY "taxonomy_templates_update" ON taxonomy_templates FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR is_admin()) WITH CHECK (created_by = auth.uid() OR is_admin());
CREATE POLICY "taxonomy_templates_delete" ON taxonomy_templates FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR is_admin());

GRANT ALL ON taxonomy_templates TO authenticated, service_role;

-- ---------- slugify helper ----------
CREATE OR REPLACE FUNCTION public.slugify(txt TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(both '-' from regexp_replace(lower(replace(coalesce(txt, ''), '&', 'and')), '[^a-z0-9]+', '-', 'g'));
$$;

-- ---------- snapshot: one channel node (recursive) ----------
CREATE OR REPLACE FUNCTION public.snapshot_channel_node(p_channel_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ch channels%ROWTYPE;
  fields JSONB;
  children JSONB;
  fn_slug TEXT;
BEGIN
  SELECT * INTO ch FROM channels WHERE id = p_channel_id;
  SELECT slug INTO fn_slug FROM functions WHERE id = ch.function_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name', f.name, 'slug', f.slug, 'field_type', f.field_type::text,
           'surface', f.surface::text, 'is_required', f.is_required, 'options', f.options,
           'formula', f.formula, 'is_auto_calc', f.is_auto_calc, 'description', f.description,
           'sort_order', f.sort_order, 'cascades_to_children', f.cascades_to_children
         ) ORDER BY f.sort_order), '[]'::jsonb)
    INTO fields
    FROM channel_fields f WHERE f.channel_id = ch.id;

  SELECT COALESCE(jsonb_agg(snapshot_channel_node(c.id) ORDER BY c.sort_order, c.name), '[]'::jsonb)
    INTO children
    FROM channels c WHERE c.parent_channel_id = ch.id;

  RETURN jsonb_build_object(
    'name', ch.name, 'slug', ch.slug, 'sort_order', ch.sort_order,
    'tier', ch.tier, 'goal', ch.goal, 'target', ch.target, 'budget_note', ch.budget_note,
    'function_slug', fn_slug,
    'extra', (ch.extra - 'bp_id' - 'owner_note'),
    'fields', fields,
    'children', children
  );
END $$;

-- ---------- snapshot: whole vertical ----------
CREATE OR REPLACE FUNCTION public.snapshot_vertical_taxonomy(p_vertical_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cats JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name', c.name, 'slug', c.slug, 'icon', c.icon, 'sort_order', c.sort_order,
           'channels', (
             SELECT COALESCE(jsonb_agg(snapshot_channel_node(ch.id) ORDER BY ch.sort_order, ch.name), '[]'::jsonb)
               FROM channels ch WHERE ch.category_id = c.id AND ch.parent_channel_id IS NULL
           )
         ) ORDER BY c.sort_order, c.name), '[]'::jsonb)
    INTO cats
    FROM categories c WHERE c.vertical_id = p_vertical_id AND c.is_active;
  RETURN jsonb_build_object('version', 1, 'categories', cats);
END $$;

-- ---------- apply: one channel node (recursive) ----------
CREATE OR REPLACE FUNCTION public.apply_template_channel(
  p_vertical_id UUID, p_category_id UUID, p_parent_id UUID, node JSONB, p_depth INT
) RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id UUID;
  fn_id UUID;
  fld JSONB;
  child JSONB;
  n INT := 1;
  v_slug TEXT;
BEGIN
  IF p_depth > 3 THEN RETURN 0; END IF;
  v_slug := COALESCE(NULLIF(node->>'slug', ''), slugify(node->>'name'));
  SELECT id INTO fn_id FROM functions WHERE slug = node->>'function_slug';

  SELECT id INTO new_id FROM channels
   WHERE category_id = p_category_id
     AND COALESCE(parent_channel_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(p_parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
     AND slug = v_slug;

  IF new_id IS NULL THEN
    INSERT INTO channels (category_id, parent_channel_id, name, slug, sort_order, tier, goal, target, budget_note, extra, function_id, vertical_id)
    VALUES (
      p_category_id, p_parent_id, node->>'name', v_slug,
      COALESCE((node->>'sort_order')::int, 0),
      NULLIF(node->>'tier', ''), NULLIF(node->>'goal', ''), NULLIF(node->>'target', ''), NULLIF(node->>'budget_note', ''),
      COALESCE(node->'extra', '{}'::jsonb), fn_id, p_vertical_id
    ) RETURNING id INTO new_id;
  ELSE
    n := 0; -- already there (idempotent re-apply): update nothing, still recurse
  END IF;

  FOR fld IN SELECT * FROM jsonb_array_elements(COALESCE(node->'fields', '[]'::jsonb)) LOOP
    INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_required, options, formula, is_auto_calc, description, sort_order, cascades_to_children)
    VALUES (
      new_id, fld->>'name', fld->>'slug',
      (fld->>'field_type')::field_type, (fld->>'surface')::field_surface,
      COALESCE((fld->>'is_required')::boolean, false),
      CASE WHEN fld ? 'options' AND jsonb_typeof(fld->'options') <> 'null' THEN fld->'options' ELSE NULL END,
      NULLIF(fld->>'formula', ''),
      COALESCE((fld->>'is_auto_calc')::boolean, false),
      NULLIF(fld->>'description', ''),
      COALESCE((fld->>'sort_order')::int, 0),
      COALESCE((fld->>'cascades_to_children')::boolean, false)
    )
    ON CONFLICT (channel_id, slug) DO NOTHING;
  END LOOP;

  FOR child IN SELECT * FROM jsonb_array_elements(COALESCE(node->'children', '[]'::jsonb)) LOOP
    n := n + apply_template_channel(p_vertical_id, p_category_id, new_id, child, p_depth + 1);
  END LOOP;
  RETURN n;
END $$;

-- ---------- apply: whole template onto a vertical ----------
CREATE OR REPLACE FUNCTION public.apply_taxonomy_template(p_vertical_id UUID, p_template_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  body JSONB;
  cat JSONB;
  ch JSONB;
  cat_id UUID;
  cat_slug TEXT;
  n_cats INT := 0;
  n_channels INT := 0;
BEGIN
  IF NOT can_manage_vertical(p_vertical_id) THEN
    RAISE EXCEPTION 'forbidden: not a manager of vertical %', p_vertical_id;
  END IF;
  SELECT t.body INTO body FROM taxonomy_templates t WHERE t.id = p_template_id;
  IF body IS NULL THEN RAISE EXCEPTION 'template % not found', p_template_id; END IF;

  FOR cat IN SELECT * FROM jsonb_array_elements(COALESCE(body->'categories', '[]'::jsonb)) LOOP
    cat_slug := COALESCE(NULLIF(cat->>'slug', ''), slugify(cat->>'name'));
    INSERT INTO categories (vertical_id, name, slug, icon, sort_order, is_active)
    VALUES (p_vertical_id, cat->>'name', cat_slug, NULLIF(cat->>'icon', ''), COALESCE((cat->>'sort_order')::int, 0), true)
    ON CONFLICT (vertical_id, slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO cat_id;
    n_cats := n_cats + 1;
    FOR ch IN SELECT * FROM jsonb_array_elements(COALESCE(cat->'channels', '[]'::jsonb)) LOOP
      n_channels := n_channels + apply_template_channel(p_vertical_id, cat_id, NULL, ch, 1);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('categories', n_cats, 'channels', n_channels);
END $$;

-- ---------- save a vertical as a template ----------
CREATE OR REPLACE FUNCTION public.save_vertical_as_template(
  p_vertical_id UUID, p_name TEXT, p_slug TEXT DEFAULT NULL, p_description TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t_id UUID;
  t_slug TEXT;
BEGIN
  IF NOT can_manage_vertical(p_vertical_id) THEN
    RAISE EXCEPTION 'forbidden: not a manager of vertical %', p_vertical_id;
  END IF;
  t_slug := COALESCE(NULLIF(p_slug, ''), slugify(p_name));
  INSERT INTO taxonomy_templates (name, slug, description, body, source_vertical_id, created_by)
  VALUES (p_name, t_slug, p_description, snapshot_vertical_taxonomy(p_vertical_id), p_vertical_id, auth.uid())
  ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name, description = EXCLUDED.description,
        body = EXCLUDED.body, source_vertical_id = EXCLUDED.source_vertical_id
  RETURNING id INTO t_id;
  RETURN t_id;
END $$;

-- ---------- create a vertical (admin), optionally from a template ----------
CREATE OR REPLACE FUNCTION public.create_vertical(
  p_name TEXT,
  p_slug TEXT DEFAULT NULL,
  p_settings JSONB DEFAULT NULL,
  p_template_id UUID DEFAULT NULL,
  p_owner_emails TEXT[] DEFAULT '{}',
  p_description TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_slug TEXT;
  em TEXT;
  i INT := 0;
BEGIN
  IF NOT (is_admin() OR is_service_role()) THEN
    RAISE EXCEPTION 'forbidden: only admins create verticals';
  END IF;
  v_slug := COALESCE(NULLIF(p_slug, ''), slugify(p_name));
  INSERT INTO verticals (name, slug, description, settings, created_by, sort_order)
  VALUES (
    p_name, v_slug, p_description,
    COALESCE(p_settings, '{"leads_pipeline":false,"weekly_report_builder":false,"resources":false,"hubspot_contacts":false}'::jsonb),
    auth.uid(),
    (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM verticals)
  ) RETURNING id INTO v_id;

  FOREACH em IN ARRAY COALESCE(p_owner_emails, '{}') LOOP
    IF em IS NOT NULL AND em <> '' THEN
      INSERT INTO vertical_owners (vertical_id, email, user_id, sort_order)
      VALUES (v_id, lower(em), (SELECT id FROM users WHERE lower(email) = lower(em) LIMIT 1), i)
      ON CONFLICT (vertical_id, email) DO NOTHING;
      i := i + 1;
    END IF;
  END LOOP;

  IF p_template_id IS NOT NULL THEN
    PERFORM apply_taxonomy_template(v_id, p_template_id);
  END IF;
  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.slugify(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_channel_node(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.snapshot_vertical_taxonomy(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_template_channel(UUID, UUID, UUID, JSONB, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_taxonomy_template(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_vertical_as_template(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_vertical(TEXT, TEXT, JSONB, UUID, TEXT[], TEXT) TO authenticated, service_role;
