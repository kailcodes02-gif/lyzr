-- ============================================================
-- Migration 036: one channel tree, product heads, open task creation,
-- and an activity log you can filter by person, channel, vertical, product.
--
-- 1) activity_log grows snapshot columns (channel, verticals, products,
--    campaign, people on the task) filled by trigger, plus entity rows for
--    things that are not task edits: heads added/removed, members, badges,
--    channel changes, campaign changes, thunderclap ticks.
-- 2) product_owners ("Product heads" in the UI). Product heads can edit any
--    task tagged with their product. can_edit_task learns about them.
-- 3) Anyone signed in can create a task with any vertical / product tag.
--    Ownership only decides who may edit someone else's task.
-- 4) The channel tree is regrouped into the agreed list. Existing channels
--    are KEPT (same ids, owners, tasks, targets, fields) and re-homed on the
--    Lyzr board; same-named copies on other verticals are merged into them;
--    dropped channels are merged into their nearest new home. Nothing is
--    deleted. Channels that match nothing are left active and listed.
-- Idempotent: safe to paste again.
-- ============================================================

SELECT set_config('lyzr.quiet', 'on', false);   -- silence the new activity triggers while we regroup

-- ============================================================
-- 1. activity_log: snapshot columns + entity rows
-- ============================================================
ALTER TABLE public.activity_log
  ADD COLUMN IF NOT EXISTS channel_id   UUID,
  ADD COLUMN IF NOT EXISTS vertical_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS product_ids  UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS campaign_id  UUID,
  ADD COLUMN IF NOT EXISTS people       UUID[] NOT NULL DEFAULT '{}',   -- actor + everyone on the task at that moment
  ADD COLUMN IF NOT EXISTS entity_type  TEXT,                           -- task | channel | vertical | product | campaign | member | badge
  ADD COLUMN IF NOT EXISTS entity_id    UUID,
  ADD COLUMN IF NOT EXISTS label        TEXT;                           -- human name of the entity (task title, channel name, ...)

CREATE INDEX IF NOT EXISTS activity_log_channel_idx  ON public.activity_log(channel_id);
CREATE INDEX IF NOT EXISTS activity_log_campaign_idx ON public.activity_log(campaign_id);
CREATE INDEX IF NOT EXISTS activity_log_people_idx   ON public.activity_log USING GIN (people);
CREATE INDEX IF NOT EXISTS activity_log_verticals_idx ON public.activity_log USING GIN (vertical_ids);
CREATE INDEX IF NOT EXISTS activity_log_products_idx ON public.activity_log USING GIN (product_ids);

-- Fill the snapshot from the task when a task row is logged.
CREATE OR REPLACE FUNCTION public.activity_log_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t RECORD; ppl UUID[];
BEGIN
  IF NEW.task_id IS NOT NULL THEN
    SELECT id, title, channel_id, vertical_ids, product_ids, campaign_id, created_by INTO t FROM tasks WHERE id = NEW.task_id;
    IF FOUND THEN
      NEW.entity_type  := COALESCE(NEW.entity_type, 'task');
      NEW.entity_id    := COALESCE(NEW.entity_id, t.id);
      NEW.label        := COALESCE(NEW.label, t.title);
      NEW.channel_id   := COALESCE(NEW.channel_id, t.channel_id);
      NEW.campaign_id  := COALESCE(NEW.campaign_id, t.campaign_id);
      IF cardinality(NEW.vertical_ids) = 0 THEN NEW.vertical_ids := COALESCE(t.vertical_ids, '{}'); END IF;
      IF cardinality(NEW.product_ids)  = 0 THEN NEW.product_ids  := COALESCE(t.product_ids,  '{}'); END IF;
      SELECT COALESCE(array_agg(DISTINCT u), '{}') INTO ppl FROM (
        SELECT user_id u FROM task_assignments WHERE task_id = t.id
        UNION SELECT t.created_by UNION SELECT NEW.actor_id) s WHERE u IS NOT NULL;
      NEW.people := ppl;
    END IF;
  ELSIF NEW.action = 'deleted' AND NEW.from_value ? 'channel_id' THEN
    NEW.entity_type := COALESCE(NEW.entity_type, 'task');
    NEW.label       := COALESCE(NEW.label, NEW.from_value ->> 'title');
    NEW.channel_id  := COALESCE(NEW.channel_id, (NEW.from_value ->> 'channel_id')::uuid);
    IF NEW.actor_id IS NOT NULL AND NOT (NEW.actor_id = ANY(NEW.people)) THEN NEW.people := NEW.people || NEW.actor_id; END IF;
  END IF;
  IF NEW.actor_id IS NOT NULL AND NOT (NEW.actor_id = ANY(NEW.people)) THEN NEW.people := NEW.people || NEW.actor_id; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS activity_log_snapshot_trg ON public.activity_log;
CREATE TRIGGER activity_log_snapshot_trg BEFORE INSERT ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_snapshot();

-- Deleted tasks: remember their verticals and products too.
CREATE OR REPLACE FUNCTION public.log_task_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO activity_log (task_id, actor_id, action, from_value, to_value, channel_id, vertical_ids, product_ids, campaign_id, entity_type, entity_id, label)
  VALUES (NULL, auth.uid(), 'deleted',
          jsonb_build_object('task_id', OLD.id, 'title', OLD.title, 'channel_id', OLD.channel_id,
                             'parent_task_id', OLD.parent_task_id, 'status', OLD.status,
                             'priority', OLD.priority, 'due_date', OLD.due_date),
          NULL, OLD.channel_id, COALESCE(OLD.vertical_ids, '{}'), COALESCE(OLD.product_ids, '{}'), OLD.campaign_id, 'task', OLD.id, OLD.title);
  RETURN OLD;
END;
$$;

-- Backfill what already exists (task rows only; the task's current tags).
UPDATE public.activity_log a
   SET entity_type = COALESCE(a.entity_type, 'task'),
       entity_id   = COALESCE(a.entity_id, t.id),
       label       = COALESCE(a.label, t.title),
       channel_id  = COALESCE(a.channel_id, t.channel_id),
       campaign_id = COALESCE(a.campaign_id, t.campaign_id),
       vertical_ids = CASE WHEN cardinality(a.vertical_ids) = 0 THEN COALESCE(t.vertical_ids, '{}') ELSE a.vertical_ids END,
       product_ids  = CASE WHEN cardinality(a.product_ids)  = 0 THEN COALESCE(t.product_ids,  '{}') ELSE a.product_ids  END,
       people = (SELECT COALESCE(array_agg(DISTINCT u), '{}') FROM (
                   SELECT user_id u FROM task_assignments WHERE task_id = t.id
                   UNION SELECT t.created_by UNION SELECT a.actor_id) s WHERE u IS NOT NULL)
  FROM public.tasks t
 WHERE t.id = a.task_id AND (a.entity_type IS NULL OR cardinality(a.people) = 0);
UPDATE public.activity_log a
   SET entity_type = 'task', label = a.from_value ->> 'title', channel_id = (a.from_value ->> 'channel_id')::uuid,
       people = CASE WHEN a.actor_id IS NULL THEN '{}' ELSE ARRAY[a.actor_id] END
 WHERE a.task_id IS NULL AND a.action = 'deleted' AND a.entity_type IS NULL AND a.from_value ? 'channel_id';

-- ---------- entity rows: heads, members, badges ----------
CREATE OR REPLACE FUNCTION public.lyzr_quiet() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT current_setting('lyzr.quiet', true) = 'on'
$$;

CREATE OR REPLACE FUNCTION public.log_role_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  verb TEXT := CASE WHEN TG_OP = 'DELETE' THEN 'removed' ELSE 'added' END;
  kind TEXT; ent UUID; lbl TEXT; chan UUID; verts UUID[] := '{}'; prods UUID[] := '{}'; who UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF lyzr_quiet() THEN RETURN NULL; END IF;
  who := COALESCE(r.user_id, (SELECT id FROM users WHERE lower(email) = lower(r.email) LIMIT 1));
  CASE TG_TABLE_NAME
    WHEN 'vertical_owners'  THEN kind := 'vertical'; ent := r.vertical_id; verts := ARRAY[r.vertical_id];
         lbl := (SELECT name FROM verticals WHERE id = r.vertical_id) || ' head';
    WHEN 'product_owners'   THEN kind := 'product';  ent := r.product_id;  prods := ARRAY[r.product_id];
         lbl := (SELECT name FROM products WHERE id = r.product_id) || ' head';
    WHEN 'channel_owners'   THEN kind := 'channel';  ent := r.channel_id;  chan := r.channel_id;
         lbl := (SELECT name FROM channels WHERE id = r.channel_id) || ' head';
    WHEN 'function_owners'  THEN kind := 'function'; ent := r.function_id;
         lbl := (SELECT name FROM functions WHERE id = r.function_id) || ' domain head';
    WHEN 'vertical_members' THEN kind := 'member';   ent := r.vertical_id; verts := ARRAY[r.vertical_id];
         lbl := (SELECT name FROM verticals WHERE id = r.vertical_id) || ' member';
    ELSE kind := TG_TABLE_NAME; lbl := TG_TABLE_NAME;
  END CASE;
  INSERT INTO activity_log (task_id, actor_id, action, from_value, to_value, channel_id, vertical_ids, product_ids, people, entity_type, entity_id, label)
  VALUES (NULL, auth.uid(), CASE WHEN kind = 'member' THEN 'member_' || verb ELSE 'head_' || verb END,
          CASE WHEN TG_OP = 'DELETE' THEN jsonb_build_object('email', r.email) END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE jsonb_build_object('email', r.email) END,
          chan, verts, prods, array_remove(ARRAY[who, auth.uid()], NULL), kind, ent, lbl);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.log_badge_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; who UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF lyzr_quiet() THEN RETURN NULL; END IF;
  who := (SELECT id FROM users WHERE lower(email) = lower(r.email) LIMIT 1);
  INSERT INTO activity_log (task_id, actor_id, action, to_value, people, entity_type, label)
  VALUES (NULL, auth.uid(), CASE WHEN TG_OP = 'DELETE' THEN 'badge_removed' ELSE 'badge_added' END,
          jsonb_build_object('email', r.email), array_remove(ARRAY[who, auth.uid()], NULL), 'badge',
          CASE WHEN TG_TABLE_NAME = 'admin_emails' THEN 'Admin' ELSE 'Leadership' END);
  RETURN NULL;
END $$;

-- ---------- entity rows: channels ----------
CREATE OR REPLACE FUNCTION public.log_channel_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE act TEXT; fv JSONB; tv JSONB;
BEGIN
  IF lyzr_quiet() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    act := 'channel_created'; tv := jsonb_build_object('name', NEW.name, 'parent_channel_id', NEW.parent_channel_id);
  ELSE
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      act := CASE WHEN NEW.is_active THEN 'channel_restored' ELSE 'channel_archived' END;
    ELSIF NEW.name IS DISTINCT FROM OLD.name OR NEW.parent_channel_id IS DISTINCT FROM OLD.parent_channel_id
       OR NEW.category_id IS DISTINCT FROM OLD.category_id OR NEW.function_id IS DISTINCT FROM OLD.function_id THEN
      act := 'channel_edited';
    ELSE
      RETURN NEW;
    END IF;
    fv := jsonb_build_object('name', OLD.name, 'parent_channel_id', OLD.parent_channel_id, 'category_id', OLD.category_id, 'is_active', OLD.is_active);
    tv := jsonb_build_object('name', NEW.name, 'parent_channel_id', NEW.parent_channel_id, 'category_id', NEW.category_id, 'is_active', NEW.is_active);
  END IF;
  INSERT INTO activity_log (task_id, actor_id, action, from_value, to_value, channel_id, people, entity_type, entity_id, label)
  VALUES (NULL, auth.uid(), act, fv, tv, NEW.id, array_remove(ARRAY[auth.uid()], NULL), 'channel', NEW.id, NEW.name);
  RETURN NEW;
END $$;

-- ---------- entity rows: campaigns and thunderclap ticks ----------
CREATE OR REPLACE FUNCTION public.log_campaign_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE act TEXT; fv JSONB; tv JSONB; verts UUID[] := '{}';
BEGIN
  IF lyzr_quiet() THEN RETURN NEW; END IF;
  IF NEW.vertical_id IS NOT NULL THEN verts := ARRAY[NEW.vertical_id]; END IF;
  IF TG_OP = 'INSERT' THEN
    act := 'campaign_created';
    tv := jsonb_build_object('kind', NEW.kind, 'status', NEW.status, 'starts_on', NEW.starts_on, 'ends_on', NEW.ends_on);
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN act := 'campaign_status';
    ELSIF NEW.name IS DISTINCT FROM OLD.name OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.starts_on IS DISTINCT FROM OLD.starts_on
       OR NEW.ends_on IS DISTINCT FROM OLD.ends_on OR NEW.ask IS DISTINCT FROM OLD.ask OR NEW.is_pinned IS DISTINCT FROM OLD.is_pinned
       OR NEW.headline IS DISTINCT FROM OLD.headline THEN act := 'campaign_edited';
    ELSE RETURN NEW; END IF;
    fv := jsonb_build_object('name', OLD.name, 'kind', OLD.kind, 'status', OLD.status, 'starts_on', OLD.starts_on, 'ends_on', OLD.ends_on, 'is_pinned', OLD.is_pinned);
    tv := jsonb_build_object('name', NEW.name, 'kind', NEW.kind, 'status', NEW.status, 'starts_on', NEW.starts_on, 'ends_on', NEW.ends_on, 'is_pinned', NEW.is_pinned);
  END IF;
  INSERT INTO activity_log (task_id, actor_id, action, from_value, to_value, campaign_id, vertical_ids, people, entity_type, entity_id, label)
  VALUES (NULL, auth.uid(), act, fv, tv, NEW.id, verts, array_remove(ARRAY[auth.uid()], NULL), 'campaign', NEW.id, NEW.name);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.log_participant_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c RECORD; who UUID;
BEGIN
  IF lyzr_quiet() OR (NEW.done_at IS NOT DISTINCT FROM OLD.done_at) THEN RETURN NEW; END IF;
  SELECT id, name, vertical_id INTO c FROM campaigns WHERE id = NEW.campaign_id;
  who := COALESCE(NEW.user_id, (SELECT id FROM users WHERE lower(email) = lower(NEW.email) LIMIT 1));
  INSERT INTO activity_log (task_id, actor_id, action, to_value, campaign_id, vertical_ids, people, entity_type, entity_id, label)
  VALUES (NULL, auth.uid(), CASE WHEN NEW.done_at IS NULL THEN 'thunderclap_undone' ELSE 'thunderclap_done' END,
          jsonb_build_object('email', NEW.email, 'proof_url', NEW.proof_url),
          c.id, CASE WHEN c.vertical_id IS NULL THEN '{}' ELSE ARRAY[c.vertical_id] END,
          array_remove(ARRAY[who, auth.uid()], NULL), 'campaign', c.id, c.name);
  RETURN NEW;
END $$;

-- ============================================================
-- 2. Product heads
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_owners (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, email)
);
CREATE INDEX IF NOT EXISTS product_owners_user_idx  ON public.product_owners(user_id);
CREATE INDEX IF NOT EXISTS product_owners_email_idx ON public.product_owners(email);
UPDATE public.product_owners o SET user_id = u.id FROM public.users u
 WHERE o.user_id IS NULL AND lower(u.email) IN (lower(o.email), lyzr_twin(o.email));

CREATE OR REPLACE FUNCTION public.is_product_owner(p UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p IS NOT NULL AND EXISTS (
    SELECT 1 FROM product_owners o
     WHERE o.product_id = p
       AND (o.user_id = auth.uid()
            OR lower(o.email) IN (SELECT lower(x) FROM users u, LATERAL unnest(ARRAY[u.email, u.alt_email]) x WHERE u.id = auth.uid() AND x IS NOT NULL)));
$$;
GRANT EXECUTE ON FUNCTION public.is_product_owner(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_product_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT o.product_id FROM product_owners o
   WHERE o.user_id = auth.uid()
      OR lower(o.email) IN (SELECT lower(x) FROM users u, LATERAL unnest(ARRAY[u.email, u.alt_email]) x WHERE u.id = auth.uid() AND x IS NOT NULL);
$$;
GRANT EXECUTE ON FUNCTION public.my_product_ids() TO authenticated, service_role;

ALTER TABLE public.product_owners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_owners_read"   ON public.product_owners;
DROP POLICY IF EXISTS "product_owners_manage" ON public.product_owners;
CREATE POLICY "product_owners_read"   ON public.product_owners FOR SELECT TO authenticated USING (true);
CREATE POLICY "product_owners_manage" ON public.product_owners FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
GRANT ALL ON public.product_owners TO authenticated, service_role;

-- Resolve the head's account when they first sign in.
CREATE OR REPLACE FUNCTION public.resolve_product_owner_on_signup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE product_owners SET user_id = NEW.id
   WHERE user_id IS NULL AND lower(email) IN (lower(NEW.email), lyzr_twin(NEW.email));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_resolve_product_owner ON public.users;
CREATE TRIGGER users_resolve_product_owner AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.resolve_product_owner_on_signup();

-- Who may edit a task: admins, the people on it, its channel head (or a
-- head above), its vertical heads, its product heads, the parent's owners.
CREATE OR REPLACE FUNCTION public.can_edit_task(t UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin() OR is_service_role() OR is_task_owner(t)
      OR EXISTS (SELECT 1 FROM tasks x WHERE x.id = t AND (
           EXISTS (SELECT 1 FROM unnest(x.vertical_ids) v WHERE is_vertical_owner(v))
           OR EXISTS (SELECT 1 FROM unnest(x.product_ids) p WHERE is_product_owner(p))
           OR owns_channel_or_ancestor(x.channel_id)))
      OR EXISTS (SELECT 1 FROM tasks x WHERE x.id = t AND x.parent_task_id IS NOT NULL AND is_task_owner(x.parent_task_id));
$$;

-- ============================================================
-- 3. Anyone signed in can create a task, with any tags
-- ============================================================
DROP POLICY IF EXISTS "tasks_insert" ON public.tasks;
CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- ============================================================
-- 4. Triggers for the entity rows (created after the tables they watch)
-- ============================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['vertical_owners', 'product_owners', 'channel_owners', 'function_owners', 'vertical_members'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_log', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_role_change()', t || '_log', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['admin_emails', 'leadership_emails'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_log', t);
      EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_badge_change()', t || '_log', t);
    END IF;
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS channels_log ON public.channels;
CREATE TRIGGER channels_log AFTER INSERT OR UPDATE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.log_channel_change();
DROP TRIGGER IF EXISTS campaigns_log ON public.campaigns;
CREATE TRIGGER campaigns_log AFTER INSERT OR UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.log_campaign_change();
DROP TRIGGER IF EXISTS campaign_participants_log ON public.campaign_participants;
CREATE TRIGGER campaign_participants_log AFTER UPDATE ON public.campaign_participants
  FOR EACH ROW EXECUTE FUNCTION public.log_participant_done();

-- ============================================================
-- 5. One channel tree
-- ============================================================
CREATE TEMP TABLE IF NOT EXISTS _placed (id UUID PRIMARY KEY);
CREATE TEMP TABLE IF NOT EXISTS _regroup (ord SERIAL, path TEXT, result TEXT, absorbed TEXT);
TRUNCATE _placed, _regroup;

-- "1.1 LinkedIn Ads", "linkedin-ads", "LinkedIn ads" all normalise to linkedinads.
CREATE OR REPLACE FUNCTION pg_temp.norm(txt TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(regexp_replace(lower(coalesce(txt, '')), '[^a-z0-9]', '', 'g'), '^[0-9]+', '')
$$;

CREATE OR REPLACE FUNCTION pg_temp.channel_path(c UUID) RETURNS TEXT LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    SELECT id, parent_channel_id, name, 0 AS d FROM channels WHERE id = c
    UNION ALL SELECT p.id, p.parent_channel_id, p.name, up.d + 1 FROM channels p JOIN up ON p.id = up.parent_channel_id)
  SELECT string_agg(name, ' › ' ORDER BY d DESC) FROM up
$$;

-- Move everything that points at `old` to `keep`, then retire `old`.
CREATE OR REPLACE FUNCTION pg_temp.absorb(old UUID, keep UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE r RECORD; kid RECORD; twin UUID; keep_cat UUID; old_path TEXT;
BEGIN
  IF old IS NULL OR keep IS NULL OR old = keep THEN RETURN; END IF;
  IF (SELECT extra ->> 'merged_into' FROM channels WHERE id = old) IS NOT NULL THEN RETURN; END IF;
  old_path := pg_temp.channel_path(old);
  SELECT category_id INTO keep_cat FROM channels WHERE id = keep;

  -- children of the retired channel sit under the keeper (merging same-slug twins)
  FOR kid IN SELECT id, slug FROM channels WHERE parent_channel_id = old AND id <> keep LOOP
    SELECT id INTO twin FROM channels WHERE parent_channel_id = keep AND slug = kid.slug AND id <> kid.id LIMIT 1;
    IF twin IS NOT NULL THEN
      PERFORM pg_temp.absorb(kid.id, twin);
    ELSE
      UPDATE channels SET parent_channel_id = keep, category_id = keep_cat WHERE id = kid.id;
    END IF;
  END LOOP;

  -- heads: keep the keeper's rows, add the rest
  INSERT INTO channel_owners (channel_id, email, user_id, sort_order)
  SELECT keep, email, user_id, sort_order + 100 FROM channel_owners WHERE channel_id = old
  ON CONFLICT (channel_id, email) DO NOTHING;
  DELETE FROM channel_owners WHERE channel_id = old;

  -- tasks that also show in the old channel
  UPDATE tasks SET planning_fields = jsonb_set(planning_fields, '{also_channels}',
      (SELECT COALESCE(jsonb_agg(DISTINCT CASE WHEN x = old::text THEN keep::text ELSE x END), '[]'::jsonb)
         FROM jsonb_array_elements_text(planning_fields -> 'also_channels') x))
   WHERE planning_fields -> 'also_channels' ? old::text;

  -- everything else with a channel_id column (tasks, targets, fields, budgets, logs, ...)
  FOR r IN SELECT c.table_name FROM information_schema.columns c
            JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
           WHERE c.table_schema = 'public' AND c.column_name = 'channel_id' AND c.data_type = 'uuid' AND c.table_name NOT IN ('channels', 'channel_owners') LOOP
    BEGIN
      EXECUTE format('UPDATE public.%I SET channel_id = $1 WHERE channel_id = $2', r.table_name) USING keep, old;
    EXCEPTION WHEN unique_violation THEN
      -- the keeper already has that row (same slug / same period): drop the duplicate copy
      EXECUTE format('DELETE FROM public.%I WHERE channel_id = $1', r.table_name) USING old;
    END;
  END LOOP;

  UPDATE channels
     SET is_active = false,
         slug = left(slug, 40) || '--merged-' || left(id::text, 8),
         extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('merged_into', keep, 'merged_by', '036', 'was', old_path)
   WHERE id = old;
  INSERT INTO activity_log (action, from_value, to_value, channel_id, entity_type, entity_id, label)
  VALUES ('channel_merged', jsonb_build_object('channel_id', old, 'path', old_path), jsonb_build_object('channel_id', keep, 'path', pg_temp.channel_path(keep)), keep, 'channel', keep, old_path);
  UPDATE _regroup SET absorbed = COALESCE(absorbed || ', ', '') || old_path WHERE ord = (SELECT max(ord) FROM _regroup);
END $$;

-- Find-or-create a channel at (category, parent, name), adopting existing
-- channels whose name matches one of the aliases (any vertical, any
-- numbering). The best-populated match is kept; the rest merge into it.
CREATE OR REPLACE FUNCTION pg_temp.want(p_cat UUID, p_parent UUID, p_name TEXT, p_sort INT, p_aliases TEXT[] DEFAULT '{}')
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  keys TEXT[] := (SELECT array_agg(DISTINCT pg_temp.norm(a)) FROM unnest(p_aliases || p_name) a);
  keep UUID; other UUID; s TEXT := public.slugify(p_name); res TEXT;
BEGIN
  SELECT c.id INTO keep FROM channels c
   WHERE (pg_temp.norm(c.name) = ANY(keys) OR pg_temp.norm(c.slug) = ANY(keys))
     AND c.slug NOT IN ('no-channel') AND c.extra ->> 'merged_into' IS NULL
     AND NOT EXISTS (SELECT 1 FROM _placed p WHERE p.id = c.id)
   ORDER BY (c.parent_channel_id IS NOT DISTINCT FROM p_parent AND c.category_id = p_cat) DESC,
            (pg_temp.norm(c.name) = pg_temp.norm(p_name)) DESC,
            (SELECT count(*) FROM channel_owners o WHERE o.channel_id = c.id) DESC,
            (SELECT count(*) FROM tasks t WHERE t.channel_id = c.id) DESC,
            c.is_active DESC, c.created_at ASC
   LIMIT 1;

  IF keep IS NULL THEN
    INSERT INTO channels (category_id, parent_channel_id, name, slug, sort_order, extra)
    VALUES (p_cat, p_parent, p_name, s, p_sort, jsonb_build_object('source', 'channel tree 036', 'regrouped_by', '036'))
    RETURNING id INTO keep;
    res := 'added';
    INSERT INTO _regroup (path, result) VALUES (pg_temp.channel_path(keep), res);
  ELSE
    res := CASE WHEN (SELECT name FROM channels WHERE id = keep) = p_name THEN 'kept' ELSE 'kept as ' || (SELECT name FROM channels WHERE id = keep) END;
    INSERT INTO _regroup (path, result) VALUES (p_name, res);
    -- detach first so absorbing an ancestor cannot loop
    UPDATE channels SET parent_channel_id = NULL WHERE id = keep AND parent_channel_id IS NOT NULL;
    INSERT INTO _placed VALUES (keep) ON CONFLICT DO NOTHING;
    FOR other IN SELECT c.id FROM channels c
                  WHERE c.id <> keep AND (pg_temp.norm(c.name) = ANY(keys) OR pg_temp.norm(c.slug) = ANY(keys))
                    AND c.slug NOT IN ('no-channel') AND c.extra ->> 'merged_into' IS NULL
                    AND NOT EXISTS (SELECT 1 FROM _placed p WHERE p.id = c.id)
                    -- a same-named channel that already lives in another regrouped slot belongs to a later call
                    AND NOT (c.extra ? 'regrouped_by' AND pg_temp.norm(c.name) = pg_temp.norm(p_name) AND c.parent_channel_id IS DISTINCT FROM p_parent) LOOP
      PERFORM pg_temp.absorb(other, keep);
    END LOOP;
    -- a stranger already at the target slot? merge it in too
    SELECT c.id INTO other FROM channels c
     WHERE c.id <> keep AND c.category_id = p_cat AND c.parent_channel_id IS NOT DISTINCT FROM p_parent AND c.slug = s LIMIT 1;
    IF other IS NOT NULL THEN PERFORM pg_temp.absorb(other, keep); END IF;
    UPDATE channels
       SET name = p_name, slug = s, category_id = p_cat, parent_channel_id = p_parent, sort_order = p_sort, is_active = true,
           goal = CASE WHEN pg_temp.norm(name) = pg_temp.norm(p_name) THEN goal END,
           extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('regrouped_by', '036')
                 || CASE WHEN pg_temp.norm(name) <> pg_temp.norm(p_name) AND goal IS NOT NULL
                         THEN jsonb_build_object('previous_name', name, 'previous_goal', goal) ELSE '{}'::jsonb END
     WHERE id = keep;
    UPDATE _regroup SET path = pg_temp.channel_path(keep) WHERE ord = (SELECT max(ord) FROM _regroup);
  END IF;
  INSERT INTO _placed VALUES (keep) ON CONFLICT DO NOTHING;
  RETURN keep;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.cat(p_slug TEXT, p_name TEXT, p_icon TEXT, p_sort INT) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE lyzr UUID := lyzr_vertical_id(); cid UUID;
BEGIN
  SELECT c.id INTO cid FROM categories c WHERE c.vertical_id = lyzr AND c.slug = p_slug LIMIT 1;
  IF cid IS NULL THEN
    INSERT INTO categories (vertical_id, name, slug, icon, sort_order) VALUES (lyzr, p_name, p_slug, p_icon, p_sort) RETURNING categories.id INTO cid;
  ELSE
    UPDATE categories SET name = p_name, sort_order = p_sort, is_active = true WHERE categories.id = cid;
  END IF;
  RETURN cid;
END $$;

DO $$
DECLARE
  c_paid UUID; c_out UUID; c_org UUID; c_adv UUID; c_ev UUID;
  p UUID; q UUID;
BEGIN
  IF lyzr_vertical_id() IS NULL THEN RAISE EXCEPTION 'The Lyzr vertical is missing; run 035 first'; END IF;

  -- Tasks move channels below; do not spam owners with "edited" notifications for it.
  ALTER TABLE tasks DISABLE TRIGGER USER;

  c_paid := pg_temp.cat('paid',     'Paid',     'megaphone', 10);
  c_out  := pg_temp.cat('outbound', 'Outbound', 'send',      20);
  c_org  := pg_temp.cat('organic',  'Organic',  'leaf',      30);
  c_adv  := pg_temp.cat('advocacy', 'Advocacy', 'heart',     40);
  c_ev   := pg_temp.cat('events',   'Events',   'calendar',  50);

  -- ---------- Paid ----------
  p := pg_temp.want(c_paid, NULL, 'Ads', 10, ARRAY['Paid Ads']);
    PERFORM pg_temp.want(c_paid, p, 'LinkedIn Ads', 1, ARRAY['1.1 LinkedIn Ads', 'LinkedIn ads']);
    PERFORM pg_temp.want(c_paid, p, 'Google Ads',   2, ARRAY['1.3 Google Ads', 'Paid search']);
    PERFORM pg_temp.want(c_paid, p, 'Meta Ads',     3, ARRAY['1.2 Meta Ads']);
    PERFORM pg_temp.want(c_paid, p, 'Reddit Ads',   4);
    PERFORM pg_temp.want(c_paid, p, 'Taboola Ads',  5, ARRAY['1.4 Taboola Ads']);
    PERFORM pg_temp.want(c_paid, p, 'X Ads',        6);
    PERFORM pg_temp.want(c_paid, p, 'Bing Ads',     7);
    PERFORM pg_temp.want(c_paid, p, 'ChatGPT Ads',  8);
  p := pg_temp.want(c_paid, NULL, 'OOH', 20, ARRAY['10.2 OOH', 'BTL']);
    PERFORM pg_temp.want(c_paid, p, 'Banners / Boards', 1);
  p := pg_temp.want(c_paid, NULL, 'Paid Organic', 30, ARRAY['Paid Organic']);
    PERFORM pg_temp.want(c_paid, p, 'Magazines & Newsletter', 1, ARRAY['6.3 Magazines / Newsletters (GSI ICP Audience)', 'Newsletter sponsorships']);
    PERFORM pg_temp.want(c_paid, p, 'Influencers & Thought leaders', 2, ARRAY['6.1 Influencers (Thought Leaders)']);

  -- ---------- Outbound ----------
  p := pg_temp.want(c_out, NULL, 'Outbound', 10, ARRAY['Email']);
    PERFORM pg_temp.want(c_out, p, 'Cold Email (Instantly)', 1, ARRAY['2.1 Instantly (Outbound)']);
    q := pg_temp.want(c_out, p, 'LinkedIn DM (PhantomBuster)', 2, ARRAY['LinkedIn outreach (1st and 2nd degree)']);
      PERFORM pg_temp.want(c_out, q, 'CXOs 1st degree connection', 1, ARRAY['9.1 1st Degree Connections of Leadership']);
      PERFORM pg_temp.want(c_out, q, 'Connection request (ABM list)', 2);
      PERFORM pg_temp.want(c_out, q, 'Leads connection with CXO', 3);
    PERFORM pg_temp.want(c_out, p, 'Playbook Leads Nurture (HubSpot)', 3, ARRAY['2.2 Hubspot (Inbound & Nurture)', 'Email nurture']);
    PERFORM pg_temp.want(c_out, p, 'ABM', 4, ARRAY['ABM SI', 'ABM GSI', 'Tier 1 accounts', 'Tier 2 accounts', 'Tier 3 accounts']);
    PERFORM pg_temp.want(c_out, p, '1-1 outreach (partnerships)', 5, ARRAY['2.3 1-1 Outreach (Partnership Team)',
      'GSIs', 'Hyperscalers', 'AWS', 'Microsoft', 'Google Cloud', 'ISV and hardware OEMs', 'Resellers, distributors and credit unions']);

  p := pg_temp.want(c_out, NULL, 'Inbound', 20);
    PERFORM pg_temp.want(c_out, p, 'Organic Leads (playbook)', 1);
    PERFORM pg_temp.want(c_out, p, 'RB2B', 2);

  -- ---------- Organic ----------
  p := pg_temp.want(c_org, NULL, 'LinkedIn Organic', 10, ARRAY['LinkedIn Organic']);
    PERFORM pg_temp.want(c_org, p, 'Lyzr AI', 1, ARRAY['3.1 Lyzr Page', 'Lyzr company page', 'LinkedIn newsletters', 'Commenting playbook']);
    PERFORM pg_temp.want(c_org, p, 'Partner Page', 2, ARRAY['3.2 GSI Page']);
    PERFORM pg_temp.want(c_org, p, 'Product showcase pages', 3, ARRAY['Product showcase pages']);
    PERFORM pg_temp.want(c_org, p, 'Founder & leader accounts', 4, ARRAY['Founder and leader voices', 'Siva (CEO)', 'Akshay (Head of Revenue)', 'Ani (CGO)', '3.3 Personal Accounts: Anju, Ani']);
    PERFORM pg_temp.want(c_org, p, 'Team accounts', 5, ARRAY['3.4 Personal Accounts: Praveen, Pooja, Kaushik, Bharath', '3.5 Personal Accounts: Kailash', 'Product managers', 'Employee advocacy']);
  p := pg_temp.want(c_org, NULL, 'Content', 20, ARRAY['Content']);
    PERFORM pg_temp.want(c_org, p, 'Blogs', 1, ARRAY['4.1 Content Portfolio & Velocity']);
    PERFORM pg_temp.want(c_org, p, 'Case studies', 2);
    PERFORM pg_temp.want(c_org, p, 'White papers and research', 3, ARRAY['White papers and research']);
    PERFORM pg_temp.want(c_org, p, 'SEO and AEO', 4, ARRAY['SEO and AEO']);
    PERFORM pg_temp.want(c_org, p, 'Landing pages', 5);
    PERFORM pg_temp.want(c_org, p, 'Comparison pages', 6);
  p := pg_temp.want(c_org, NULL, 'Technical Content', 30);
    PERFORM pg_temp.want(c_org, p, 'Playbooks', 1);
    PERFORM pg_temp.want(c_org, p, 'Blueprints', 2);
    PERFORM pg_temp.want(c_org, p, 'Assessments', 3);
    PERFORM pg_temp.want(c_org, p, 'Templates', 4);
  PERFORM pg_temp.want(c_org, NULL, 'PR', 40, ARRAY['6.2 PR', 'PR and press releases', 'Forbes and trade press', 'Monthly thunderclaps']);
  p := pg_temp.want(c_org, NULL, 'Newsletter', 50);
    PERFORM pg_temp.want(c_org, p, 'Beehiiv', 1, ARRAY['2.4 Newsletter (Beehiiv)']);
  p := pg_temp.want(c_org, NULL, 'Webinar', 60, ARRAY['7.1 Webinar', 'Webinars', 'Longform Content & Co-marketing']);
    PERFORM pg_temp.want(c_org, p, 'Lyzr hosted', 1);
    PERFORM pg_temp.want(c_org, p, 'Co-marketing', 2);
  p := pg_temp.want(c_org, NULL, 'Podcast', 70, ARRAY['7.2 Podcast', 'Podcasts']);
    PERFORM pg_temp.want(c_org, p, 'Lyzr hosted', 1);
    PERFORM pg_temp.want(c_org, p, 'Lyzr as guest', 2);
  p := pg_temp.want(c_org, NULL, 'Video & Content', 80);
    PERFORM pg_temp.want(c_org, p, 'Lyzr Creators', 1, ARRAY['4.2 In-House Creator Videos (Accenture Focus)']);
    PERFORM pg_temp.want(c_org, p, 'AI videos', 2);
    PERFORM pg_temp.want(c_org, p, 'YouTube', 3, ARRAY['YouTube and 60-second films']);
    PERFORM pg_temp.want(c_org, p, 'Short videos', 4);
    PERFORM pg_temp.want(c_org, p, 'Ad Assets', 5);
  p := pg_temp.want(c_org, NULL, 'Designs', 90);
    PERFORM pg_temp.want(c_org, p, 'Sales collateral', 1, ARRAY['Sales collateral', 'SDR enablement']);
    PERFORM pg_temp.want(c_org, p, 'Event Assets', 2);
    PERFORM pg_temp.want(c_org, p, 'Banner & Goodies', 3);

  -- ---------- Advocacy ----------
  p := pg_temp.want(c_adv, NULL, 'Communities', 10, ARRAY['Communities']);
    PERFORM pg_temp.want(c_adv, p, 'Reddit', 1);
    PERFORM pg_temp.want(c_adv, p, 'Developer communities', 2, ARRAY['8.3 Online (Non Chatable)', '8.4 Slack / Equivalent']);
    PERFORM pg_temp.want(c_adv, p, 'GSI Communities', 3, ARRAY['8.1 Offline Communities', '8.2 Paid Membership']);
    PERFORM pg_temp.want(c_adv, p, 'Investor and peer networks', 4, ARRAY['Investor and peer networks']);
  p := pg_temp.want(c_adv, NULL, 'Analyst relationship', 20, ARRAY['11.3 Analyst Relationship', 'Analysts']);
    PERFORM pg_temp.want(c_adv, p, 'G2', 1);
    PERFORM pg_temp.want(c_adv, p, 'Forrester', 2);
    PERFORM pg_temp.want(c_adv, p, 'Gartner', 3);
    PERFORM pg_temp.want(c_adv, p, 'Other Analysts', 4);
  p := pg_temp.want(c_adv, NULL, 'Champions', 30, ARRAY['Foster Champions', '11.2 Champions']);
    PERFORM pg_temp.want(c_adv, p, 'Gifting', 1, ARRAY['10.1 Gifting']);
    PERFORM pg_temp.want(c_adv, p, 'Testimonials', 2, ARRAY['11.1 Testimonials', '4.3 Video Testimonials']);
  p := pg_temp.want(c_adv, NULL, 'Referral', 40, ARRAY['Referrals']);
    PERFORM pg_temp.want(c_adv, p, 'Internal Referral', 1, ARRAY['9.2 Employee Referral']);

  -- ---------- Events ----------
  p := pg_temp.want(c_ev, NULL, 'Events', 10, ARRAY['Events']);
    PERFORM pg_temp.want(c_ev, p, 'Lyzr closed rooms', 1, ARRAY['5.1 Hosted by Lyzr', 'Owned nights', 'Executive dinners']);
    PERFORM pg_temp.want(c_ev, p, 'Co-hosted', 2, ARRAY['5.3 Co-Hosted']);
    PERFORM pg_temp.want(c_ev, p, 'Attending', 3, ARRAY['5.2 Hosted by Others', 'Trade shows']);
    PERFORM pg_temp.want(c_ev, p, 'Speaker / panelist', 4);
  p := pg_temp.want(c_ev, NULL, 'Workshops & Cohorts', 20, ARRAY['10.3 Workshops & Cohorts']);
    PERFORM pg_temp.want(c_ev, p, 'Unlock city', 1, ARRAY['Events by city']);
    PERFORM pg_temp.want(c_ev, p, 'Workshops', 2);
    PERFORM pg_temp.want(c_ev, p, 'Cohorts', 3);
    PERFORM pg_temp.want(c_ev, p, 'Masterclass', 4, ARRAY['Masterclasses']);
    PERFORM pg_temp.want(c_ev, p, 'Hackathon', 5, ARRAY['Hackathons']);

  -- Children left under a re-homed parent follow its category (the schema
  -- wants parent and child in one category).
  UPDATE channels c SET category_id = p.category_id
    FROM channels p WHERE p.id = c.parent_channel_id AND c.category_id <> p.category_id;

  ALTER TABLE tasks ENABLE TRIGGER USER;

  -- One "No channel" per board; only Lyzr's stays active.
  UPDATE channels SET is_active = (vertical_id = lyzr_vertical_id()) WHERE slug = 'no-channel' AND parent_channel_id IS NULL;

  -- Folders with nothing active left in them fold away.
  UPDATE categories cat SET is_active = false
   WHERE cat.is_active AND NOT EXISTS (SELECT 1 FROM channels ch WHERE ch.category_id = cat.id AND ch.is_active);
  UPDATE categories cat SET is_active = true
   WHERE NOT cat.is_active AND EXISTS (SELECT 1 FROM channels ch WHERE ch.category_id = cat.id AND ch.is_active);
END $$;

SELECT set_config('lyzr.quiet', 'off', false);

-- ============================================================
-- Verify
-- ============================================================
-- 1) The tree as built: every channel, what happened to it, what merged into it.
SELECT ord, path, result, absorbed FROM _regroup ORDER BY ord;

-- 2) Active channels that matched nothing (left as they were; move them by hand if needed).
SELECT v.slug AS vertical, cat.name AS folder, pg_temp.channel_path(c.id) AS channel, c.slug,
       (SELECT count(*) FROM tasks t WHERE t.channel_id = c.id) AS tasks,
       (SELECT count(*) FROM channel_owners o WHERE o.channel_id = c.id) AS heads
  FROM channels c JOIN verticals v ON v.id = c.vertical_id LEFT JOIN categories cat ON cat.id = c.category_id
 WHERE c.is_active AND c.slug <> 'no-channel' AND NOT EXISTS (SELECT 1 FROM _placed p WHERE p.id = c.id)
 ORDER BY 1, 2, 3;

-- 3) Totals. Expect: 0 tasks on inactive channels, 0 active channels outside Lyzr
--    (except strays listed above), every active sub-channel in its parent's folder.
SELECT
  (SELECT count(*) FROM channels WHERE is_active) AS active_channels,
  (SELECT count(*) FROM channels WHERE is_active AND parent_channel_id IS NULL AND slug <> 'no-channel') AS top_level,
  (SELECT count(*) FROM tasks t JOIN channels c ON c.id = t.channel_id WHERE NOT c.is_active) AS tasks_on_inactive_channels,   -- 0
  (SELECT count(*) FROM channels c JOIN channels p ON p.id = c.parent_channel_id WHERE c.is_active AND c.category_id <> p.category_id) AS mismatched_folders,  -- 0
  (SELECT count(*) FROM channel_owners) AS channel_head_rows,
  (SELECT count(*) FROM product_owners) AS product_head_rows,
  (SELECT count(*) FROM activity_log WHERE entity_type IS NULL) AS unlabelled_log_rows;   -- 0
