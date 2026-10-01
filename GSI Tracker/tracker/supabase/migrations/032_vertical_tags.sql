-- 032: Verticals become TAGS on tasks. One board (Lyzr) holds everything.
-- Idempotent. Run after 031.
--
--  * tasks.vertical_ids: one or more vertical tags per task. "Lyzr" means
--    not vertical-specific, so it is dropped automatically once a real
--    vertical tag is present, and used when nothing else is given.
--    Sub-tasks with no tags take their parent's.
--  * Backfilled from today's model: a task's tags = the vertical of its
--    channel + the verticals of any extra channels it also shows in.
--  * Channels are untagged and usable by every task. channels.vertical_id
--    stays only as the channel's "primary for" vertical (where it was made;
--    listed first in that vertical's view, and its owners manage it).
--  * One shared "No channel" (Lyzr's). The other verticals' buckets are
--    emptied into it (tags keep each task in its vertical's view) and
--    switched off. Done without History/notification noise.
--  * Permissions follow tags: vertical owners edit tasks tagged with their
--    vertical; creating a task needs membership of every vertical it's
--    tagged with (admins: any).

-- ---------- 1. column ----------
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS vertical_ids UUID[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS tasks_vertical_ids_idx ON public.tasks USING GIN (vertical_ids);

CREATE OR REPLACE FUNCTION public.lyzr_vertical_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM verticals WHERE slug = 'lyzr' LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.lyzr_vertical_id() TO authenticated, anon, service_role;

-- ---------- 2. backfill (before the normalising trigger exists) ----------
-- Triggers are paused for the backfill + bucket merge so 1000s of rows don't
-- each write a History entry and notify their owners.
ALTER TABLE public.tasks DISABLE TRIGGER USER;

UPDATE public.tasks t SET vertical_ids = sub.v
FROM (
  SELECT t2.id, array_agg(DISTINCT c.vertical_id) FILTER (WHERE c.vertical_id IS NOT NULL) AS v
  FROM public.tasks t2
  JOIN LATERAL (
    SELECT t2.channel_id AS ch
    UNION
    SELECT x::uuid FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(t2.planning_fields -> 'also_channels') = 'array' THEN t2.planning_fields -> 'also_channels' ELSE '[]'::jsonb END) x
    WHERE x ~ '^[0-9a-f-]{36}$'
  ) chans ON true
  JOIN public.channels c ON c.id = chans.ch
  GROUP BY t2.id
) sub
WHERE t.id = sub.id AND t.vertical_ids = '{}' AND sub.v IS NOT NULL;

-- Lyzr is "no vertical": drop it wherever a real vertical is present.
UPDATE public.tasks SET vertical_ids = array_remove(vertical_ids, lyzr_vertical_id())
 WHERE cardinality(vertical_ids) > 1 AND lyzr_vertical_id() = ANY(vertical_ids);
UPDATE public.tasks SET vertical_ids = ARRAY[lyzr_vertical_id()]
 WHERE vertical_ids = '{}' AND lyzr_vertical_id() IS NOT NULL;

-- One shared "No channel": move tasks out of the other verticals' buckets.
UPDATE public.tasks t SET channel_id = public.ensure_no_channel(lyzr_vertical_id())
  FROM public.channels c
 WHERE c.id = t.channel_id AND c.slug = 'no-channel' AND c.parent_channel_id IS NULL
   AND c.vertical_id IS DISTINCT FROM lyzr_vertical_id();

ALTER TABLE public.tasks ENABLE TRIGGER USER;

UPDATE public.channels SET is_active = false
 WHERE slug = 'no-channel' AND parent_channel_id IS NULL AND vertical_id IS DISTINCT FROM lyzr_vertical_id();

-- Every vertical now shares Lyzr's bucket (old callers keep working).
CREATE OR REPLACE FUNCTION public.ensure_no_channel(v UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lyzr UUID := lyzr_vertical_id();
  home UUID := COALESCE(lyzr, v);
  cat UUID;
  ch UUID;
BEGIN
  SELECT id INTO ch FROM channels WHERE vertical_id = home AND slug = 'no-channel' AND parent_channel_id IS NULL LIMIT 1;
  IF ch IS NOT NULL THEN RETURN ch; END IF;
  SELECT id INTO cat FROM categories WHERE vertical_id = home AND slug = 'general' LIMIT 1;
  IF cat IS NULL THEN
    INSERT INTO categories (name, slug, sort_order, vertical_id) VALUES ('General', 'general', -100, home) RETURNING id INTO cat;
  END IF;
  INSERT INTO channels (category_id, vertical_id, parent_channel_id, name, slug, sort_order)
  VALUES (cat, home, NULL, 'No channel', 'no-channel', -100) RETURNING id INTO ch;
  RETURN ch;
END;
$$;

-- ---------- 3. keep tags valid on every write ----------
CREATE OR REPLACE FUNCTION public.normalise_task_verticals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lyzr UUID := lyzr_vertical_id();
  bad UUID;
BEGIN
  NEW.vertical_ids := COALESCE(NEW.vertical_ids, '{}');
  IF cardinality(NEW.vertical_ids) = 0 AND NEW.parent_task_id IS NOT NULL THEN
    SELECT vertical_ids INTO NEW.vertical_ids FROM tasks WHERE id = NEW.parent_task_id;
    NEW.vertical_ids := COALESCE(NEW.vertical_ids, '{}');
  END IF;
  -- de-duplicate, keep order
  NEW.vertical_ids := ARRAY(SELECT v FROM unnest(NEW.vertical_ids) WITH ORDINALITY AS u(v, i) GROUP BY v ORDER BY min(i));
  IF cardinality(NEW.vertical_ids) > 1 AND lyzr IS NOT NULL THEN
    NEW.vertical_ids := array_remove(NEW.vertical_ids, lyzr);
  END IF;
  IF cardinality(NEW.vertical_ids) = 0 AND lyzr IS NOT NULL THEN
    NEW.vertical_ids := ARRAY[lyzr];
  END IF;
  SELECT v INTO bad FROM unnest(NEW.vertical_ids) v WHERE NOT EXISTS (SELECT 1 FROM verticals x WHERE x.id = v) LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown vertical %', bad USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tasks_normalise_verticals ON public.tasks;
CREATE TRIGGER tasks_normalise_verticals BEFORE INSERT OR UPDATE OF vertical_ids, parent_task_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.normalise_task_verticals();

-- A deleted vertical leaves its tasks with the remaining tags (or Lyzr).
CREATE OR REPLACE FUNCTION public.untag_deleted_vertical()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE tasks SET vertical_ids = array_remove(vertical_ids, OLD.id) WHERE OLD.id = ANY(vertical_ids);
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS verticals_untag_tasks ON public.verticals;
CREATE TRIGGER verticals_untag_tasks BEFORE DELETE ON public.verticals
  FOR EACH ROW EXECUTE FUNCTION public.untag_deleted_vertical();

-- ---------- 4. permissions follow tags ----------
CREATE OR REPLACE FUNCTION public.can_edit_task(t UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin() OR is_service_role() OR is_task_owner(t)
      OR EXISTS (SELECT 1 FROM tasks x WHERE x.id = t AND (
           EXISTS (SELECT 1 FROM unnest(x.vertical_ids) v WHERE is_vertical_owner(v))
           OR owns_channel_or_ancestor(x.channel_id)))
      -- owners of the parent activity may edit its sub-tasks
      OR EXISTS (SELECT 1 FROM tasks x WHERE x.id = t AND x.parent_task_id IS NOT NULL AND is_task_owner(x.parent_task_id));
$$;

DROP POLICY IF EXISTS "tasks_insert" ON public.tasks;
CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by
    AND cardinality(vertical_ids) > 0
    AND NOT EXISTS (SELECT 1 FROM unnest(vertical_ids) v WHERE NOT is_vertical_member(v)));

-- ---------- 5. History records tag changes ----------
CREATE OR REPLACE FUNCTION public.log_task_edit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f TEXT; changed TEXT[] := '{}';
  fields TEXT[] := ARRAY['title','description','priority','status','due_date','channel_id','parent_task_id',
                         'budget_allocated','budget_period_id','campaign_id','result_url','blocked_reason','blocked_by_email',
                         'planning_fields','tracker_fields','vertical_ids'];
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

-- Verify: tasks per tag (every task has ≥1), untagged = 0, one active "No channel".
SELECT
  (SELECT count(*) FROM public.tasks WHERE cardinality(vertical_ids) = 0) AS untagged_tasks,             -- 0
  (SELECT count(*) FROM public.channels WHERE slug = 'no-channel' AND is_active) AS active_no_channel,   -- 1
  (SELECT string_agg(v.name || ': ' || (SELECT count(*) FROM public.tasks t WHERE v.id = ANY(t.vertical_ids)), ', ' ORDER BY v.sort_order)
     FROM public.verticals v) AS tasks_per_tag;
