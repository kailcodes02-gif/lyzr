-- 027: Lyzr is the primary vertical, and every vertical gets a "No channel"
-- bucket for tasks that don't belong to any channel. Idempotent.
--
-- Why a bucket instead of a NULL channel_id: every task's vertical — and so
-- who may create/edit it (tasks_insert → is_vertical_member(channel_vertical(
-- channel_id))) — is derived from its channel. A NULL channel would silently
-- break those policies and every view. The app shows this channel as
-- "No channel" and uses it whenever a task is created without one.

-- 1) Lyzr sorts first (only moves it if something sorts before or with it).
UPDATE public.verticals
SET sort_order = (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM public.verticals WHERE slug <> 'lyzr')
WHERE slug = 'lyzr'
  AND sort_order >= (SELECT COALESCE(MIN(sort_order), 0) FROM public.verticals WHERE slug <> 'lyzr');

-- 2) One "General" group + "No channel" channel per vertical.
CREATE OR REPLACE FUNCTION public.ensure_no_channel(v UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cat UUID;
  ch UUID;
BEGIN
  SELECT id INTO ch FROM channels WHERE vertical_id = v AND slug = 'no-channel' AND parent_channel_id IS NULL LIMIT 1;
  IF ch IS NOT NULL THEN RETURN ch; END IF;

  SELECT id INTO cat FROM categories WHERE vertical_id = v AND slug = 'general' LIMIT 1;
  IF cat IS NULL THEN
    INSERT INTO categories (name, slug, sort_order, vertical_id)
    VALUES ('General', 'general', -100, v) RETURNING id INTO cat;
  END IF;

  INSERT INTO channels (category_id, vertical_id, parent_channel_id, name, slug, sort_order)
  VALUES (cat, v, NULL, 'No channel', 'no-channel', -100) RETURNING id INTO ch;
  RETURN ch;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_no_channel(UUID) TO authenticated, service_role;

SELECT public.ensure_no_channel(id) FROM public.verticals;

-- New verticals get their bucket automatically.
CREATE OR REPLACE FUNCTION public.verticals_add_no_channel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ensure_no_channel(NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_verticals_add_no_channel ON public.verticals;
CREATE TRIGGER trg_verticals_add_no_channel
  AFTER INSERT ON public.verticals
  FOR EACH ROW EXECUTE FUNCTION public.verticals_add_no_channel();

-- 3) Verify: Lyzr first, one "No channel" per vertical.
SELECT v.name, v.sort_order,
       (SELECT count(*) FROM public.channels c WHERE c.vertical_id = v.id AND c.slug = 'no-channel') AS no_channel_buckets
FROM public.verticals v
ORDER BY v.sort_order, v.name;
