-- 034: Product tags on tasks. Idempotent. Run after 033.
--
--  * products: the Lyzr product catalogue, taken from the lyzr.ai navbar
--    (Nov 2026): the "Products" menu, the agents under "Solutions", plus the
--    extra values HubSpot's "Product track" property uses. Admins add /
--    rename / switch off products; everyone signed in can read them.
--  * "Lyzr" is the brand-level product: a task about Lyzr as a whole, not one
--    product. Every task has at least one product: Lyzr when nothing else is
--    given, and Lyzr is dropped as soon as a real product is tagged (the same
--    rule as verticals in 032). Sub-tasks created without tags take their
--    parent's.
--  * products.hubspot_tracks: the HubSpot contact "Product track" values that
--    belong to the product. The Sales pipeline pulls leads by these.
--  * Tags never affect permissions; History records tag changes.

-- ---------- 1. catalogue ----------
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  group_name TEXT NOT NULL DEFAULT 'Other',
  description TEXT,
  url TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS hubspot_tracks TEXT[] NOT NULL DEFAULT '{}';

DROP TRIGGER IF EXISTS products_updated_at ON public.products;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_read"  ON public.products;
DROP POLICY IF EXISTS "products_write" ON public.products;
CREATE POLICY "products_read"  ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "products_write" ON public.products FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
GRANT SELECT ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;

INSERT INTO public.products (name, slug, group_name, description, url, sort_order, hubspot_tracks) VALUES
  ('Lyzr',           'lyzr',           'Lyzr',      'Brand-level: Lyzr as a whole, not one product',            'https://www.lyzr.ai/',                         0,   '{}'),
  -- navbar › Products
  ('Agent Studio',   'agent-studio',   'Products',  'Build and run agents',                                     'https://www.lyzr.ai/lyzr-agent-studio/',       10,  '{"Agent Studio"}'),
  ('Architect',      'architect',      'Products',  'Build without code (architect.new)',                       'https://architect.new/',                       20,  '{}'),
  ('Reimaginer',     'reimaginer',     'Products',  'Start with workflows; AI FDE test drive',                  'https://www.lyzr.ai/reimaginer/',              30,  '{"Reimaginer"}'),
  ('Openfinetuner',  'openfinetuner',  'Products',  'Fine-tune open models',                                    'https://www.lyzr.ai/open-finetuner/',          40,  '{"Open Finetuner"}'),
  ('Optimus',        'optimus',        'Products',  'On-prem AI hardware',                                      'https://www.lyzr.ai/optimus/',                 50,  '{"Optimus"}'),
  ('Sovereign AI',   'sovereign-ai',   'Products',  'Own your stack',                                           'https://www.lyzr.ai/sovereign-ai/',            60,  '{}'),
  ('Open Cowork',    'open-cowork',    'Products',  'AI for every employee',                                    'https://www.lyzr.ai/open-cowork/',             70,  '{"Open Cowork"}'),
  ('Opencontroller', 'opencontroller', 'Products',  'Govern all your AI agents',                                'https://www.lyzr.ai/opencontroller/',          80,  '{"Opencontroller"}'),
  -- navbar › Solutions (the named agents)
  ('Madison',        'madison',        'Agents',    'Banking: lending, onboarding and compliance',              'https://www.lyzr.ai/banking-agents/',          110, '{"Madison"}'),
  ('Benjie',         'benjie',         'Agents',    'Insurance: claims, underwriting and policy',               'https://www.lyzr.ai/insurance-ai-agent-benjie/', 120, '{}'),
  ('Jazon',          'jazon',          'Agents',    'Revenue: pipeline generation and sales (AI SDR)',          'https://www.lyzr.ai/jazon/',                   130, '{}'),
  ('Skott',          'skott',          'Agents',    'Marketing: content, campaigns and demand',                 'https://www.lyzr.ai/skott/',                   140, '{}'),
  ('Jeff',           'jeff',           'Agents',    'Customer service: resolution and ticket deflection',       'https://www.lyzr.ai/jeff/',                    150, '{}'),
  ('Diane',          'diane',          'Agents',    'Human resources: hiring, onboarding and people ops',       'https://www.lyzr.ai/diane/',                   160, '{}'),
  -- HubSpot "Product track" values that are not in the navbar
  ('AgentBlocks',    'agentblocks',    'Other',     'White-label agent platform and embeddable SDKs',           'https://www.lyzr.ai/agentblocks/',             210, '{"Agent Blocks"}'),
  ('Spotlight',      'spotlight',      'Other',     'Spotlight (HubSpot product track)',                        NULL,                                           220, '{"Spotlight"}'),
  ('Alpha',          'alpha',          'Other',     'Alpha (HubSpot product track)',                            NULL,                                           230, '{"Alpha"}')
ON CONFLICT (slug) DO UPDATE SET
  group_name     = EXCLUDED.group_name,
  sort_order     = EXCLUDED.sort_order,
  hubspot_tracks = CASE WHEN products.hubspot_tracks = '{}' THEN EXCLUDED.hubspot_tracks ELSE products.hubspot_tracks END;

-- An earlier draft of this migration seeded a wider list from the whole site.
-- Those are switched off, not deleted, so any tag on a task survives.
UPDATE public.products SET is_active = false
 WHERE slug IN ('agentic-os','cognis','lyzrgpt','dwight','kathy','gitagent','opengap') AND is_active;

CREATE OR REPLACE FUNCTION public.lyzr_product_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM products WHERE slug = 'lyzr' LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.lyzr_product_id() TO authenticated, anon, service_role;

-- Lyzr is the default product: it can't be deleted, switched off or re-slugged.
CREATE OR REPLACE FUNCTION public.protect_lyzr_product()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.slug = 'lyzr' THEN RAISE EXCEPTION 'Lyzr is the default product and cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.slug = 'lyzr' AND (NEW.is_active = false OR NEW.slug IS DISTINCT FROM 'lyzr') THEN
    RAISE EXCEPTION 'Lyzr is the default product: it stays active and keeps its slug';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_lyzr_product ON public.products;
CREATE TRIGGER trg_protect_lyzr_product BEFORE UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.protect_lyzr_product();

-- ---------- 2. column + backfill ----------
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS product_ids UUID[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS tasks_product_ids_idx ON public.tasks USING GIN (product_ids);

-- Every existing task becomes a Lyzr (brand-level) task. Triggers are paused
-- so this doesn't write a History entry or notify owners for every task.
ALTER TABLE public.tasks DISABLE TRIGGER USER;
UPDATE public.tasks SET product_ids = ARRAY[lyzr_product_id()]
 WHERE product_ids = '{}' AND lyzr_product_id() IS NOT NULL;
UPDATE public.tasks SET product_ids = array_remove(product_ids, lyzr_product_id())
 WHERE cardinality(product_ids) > 1 AND lyzr_product_id() = ANY(product_ids);
ALTER TABLE public.tasks ENABLE TRIGGER USER;

-- ---------- 3. keep tags valid on every write ----------
CREATE OR REPLACE FUNCTION public.normalise_task_products()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lyzr UUID := lyzr_product_id();
  bad UUID;
BEGIN
  NEW.product_ids := COALESCE(NEW.product_ids, '{}');
  IF TG_OP = 'INSERT' AND cardinality(NEW.product_ids) = 0 AND NEW.parent_task_id IS NOT NULL THEN
    SELECT product_ids INTO NEW.product_ids FROM tasks WHERE id = NEW.parent_task_id;
    NEW.product_ids := COALESCE(NEW.product_ids, '{}');
  END IF;
  -- de-duplicate, keep order
  NEW.product_ids := ARRAY(SELECT p FROM unnest(NEW.product_ids) WITH ORDINALITY AS u(p, i) GROUP BY p ORDER BY min(i));
  IF cardinality(NEW.product_ids) > 1 AND lyzr IS NOT NULL THEN
    NEW.product_ids := array_remove(NEW.product_ids, lyzr);
  END IF;
  IF cardinality(NEW.product_ids) = 0 AND lyzr IS NOT NULL THEN
    NEW.product_ids := ARRAY[lyzr];
  END IF;
  SELECT p INTO bad FROM unnest(NEW.product_ids) p WHERE NOT EXISTS (SELECT 1 FROM products x WHERE x.id = p) LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown product %', bad USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tasks_normalise_products ON public.tasks;
CREATE TRIGGER tasks_normalise_products BEFORE INSERT OR UPDATE OF product_ids ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.normalise_task_products();

-- A deleted product is removed from its tasks (they fall back to Lyzr).
CREATE OR REPLACE FUNCTION public.untag_deleted_product()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE tasks SET product_ids = array_remove(product_ids, OLD.id) WHERE OLD.id = ANY(product_ids);
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS products_untag_tasks ON public.products;
CREATE TRIGGER products_untag_tasks BEFORE DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.untag_deleted_product();

-- ---------- 4. History records product tag changes (032's function + product_ids) ----------
CREATE OR REPLACE FUNCTION public.log_task_edit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f TEXT; changed TEXT[] := '{}';
  fields TEXT[] := ARRAY['title','description','priority','status','due_date','channel_id','parent_task_id',
                         'budget_allocated','budget_period_id','campaign_id','result_url','blocked_reason','blocked_by_email',
                         'planning_fields','tracker_fields','vertical_ids','product_ids'];
  o JSONB := to_jsonb(OLD); n JSONB := to_jsonb(NEW);
BEGIN
  FOREACH f IN ARRAY fields LOOP
    IF (o -> f) IS DISTINCT FROM (n -> f) THEN
      IF f = 'status' THEN CONTINUE; END IF;
      INSERT INTO activity_log (task_id, actor_id, action, from_value, to_value)
      VALUES (NEW.id, auth.uid(), 'edited', jsonb_build_object('field', f, 'value', o -> f), jsonb_build_object('field', f, 'value', n -> f));
      changed := changed || f;
    END IF;
  END LOOP;
  IF array_length(changed, 1) > 0 THEN
    PERFORM notify_task(NEW.id, 'task_edited', jsonb_build_object('fields', to_jsonb(changed)), auth.uid());
  END IF;
  RETURN NEW;
END; $$;

-- Verify: 18 active products (Lyzr + 17), no task without a product.
SELECT
  (SELECT count(*) FROM public.products WHERE is_active) AS active_products,                     -- 18
  (SELECT count(*) FROM public.tasks WHERE product_ids = '{}') AS tasks_without_product;          -- 0
