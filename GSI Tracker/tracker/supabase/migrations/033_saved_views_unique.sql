-- 033: restore saved_views' planned uniqueness. Idempotent.
--
-- Migration 009 declared UNIQUE (user_id, page, name), but the live table
-- predates it and never got the constraint (found during the 2026-10-05
-- hygiene audit: PostgREST refused on_conflict with 42P10). Without it,
-- nothing stops duplicate "same view" rows. Dedupe (keep the newest), then
-- add the constraint.

DELETE FROM public.saved_views a
 USING public.saved_views b
 WHERE a.user_id = b.user_id AND a.page = b.page AND a.name = b.name
   AND (a.updated_at, a.id) < (b.updated_at, b.id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.saved_views'::regclass AND contype = 'u'
      AND conkey = (SELECT array_agg(attnum ORDER BY attnum) FROM pg_attribute
                    WHERE attrelid = 'public.saved_views'::regclass AND attname IN ('user_id', 'page', 'name'))
  ) THEN
    ALTER TABLE public.saved_views ADD CONSTRAINT saved_views_user_page_name_key UNIQUE (user_id, page, name);
  END IF;
END $$;

-- Verify: 1 row, constraint present, no duplicates left.
SELECT
  (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.saved_views'::regclass AND conname = 'saved_views_user_page_name_key') AS constraint_present, -- 1
  (SELECT count(*) FROM (SELECT user_id, page, name FROM public.saved_views GROUP BY 1, 2, 3 HAVING count(*) > 1) d) AS remaining_duplicates;               -- 0
