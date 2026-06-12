-- ============================================================
-- STEP 0: READ-ONLY DIAGNOSTIC (single-result version)
-- Paste into Supabase SQL Editor and Run.
-- Returns ONE table with 9 labeled sections. Share/screenshot it all.
-- No writes; safe to rerun anytime.
-- ============================================================

WITH diag AS (
  -- 1. Your role + Kailash's
  SELECT 1 AS section, 'role'::text AS metric, email AS detail, role::text AS value
  FROM public.users
  WHERE email IN ('subs@lyzr.ai', 'kailash.gm@lyzr.ai')

  UNION ALL

  -- 2. Every table in public
  SELECT 2, 'table', table_name, NULL
  FROM information_schema.tables
  WHERE table_schema = 'public'

  UNION ALL

  -- 3. Every view in public
  SELECT 3, 'view', table_name, NULL
  FROM information_schema.views
  WHERE table_schema = 'public'

  UNION ALL

  -- 4. Columns on `tasks` (flagging the two we care about most)
  SELECT 4, 'tasks_column',
         column_name,
         data_type || CASE WHEN column_name IN ('recurring_template_id','tracker_frozen_at') THEN '  ← Phase 2' ELSE '' END
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'tasks'

  UNION ALL

  -- 5. Triggers on `tasks`
  SELECT 5, 'tasks_trigger', trigger_name, event_manipulation || ' ' || action_timing
  FROM information_schema.triggers
  WHERE event_object_schema = 'public' AND event_object_table = 'tasks'

  UNION ALL

  -- 6. Is the Phase 2 version of handle_task_status_change installed?
  --    (Looks for the tracker_frozen_at substring in the function body.)
  SELECT 6, 'function_check', 'handle_task_status_change',
         CASE
           WHEN pg_get_functiondef(p.oid) ILIKE '%tracker_frozen_at%' THEN 'Phase 2 (sets tracker_frozen_at)'
           ELSE 'Phase 1 (no tracker_frozen_at)'
         END
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE p.proname = 'handle_task_status_change' AND n.nspname = 'public'

  UNION ALL

  -- 7. Public enums (recurrence_pattern is the Phase 2 canary)
  SELECT 7, 'enum', t.typname,
         array_to_string(array_agg(e.enumlabel ORDER BY e.enumsortorder), ', ')
  FROM pg_type t
  JOIN pg_enum e ON t.oid = e.enumtypid
  JOIN pg_namespace n ON t.typnamespace = n.oid
  WHERE n.nspname = 'public'
  GROUP BY t.typname

  UNION ALL

  -- 8. Row counts on the core (migration 001) tables — how much real data exists
  SELECT 8, 'rowcount', 'users',            count(*)::text FROM public.users
  UNION ALL SELECT 8, 'rowcount', 'categories',       count(*)::text FROM public.categories
  UNION ALL SELECT 8, 'rowcount', 'channels',         count(*)::text FROM public.channels
  UNION ALL SELECT 8, 'rowcount', 'channel_fields',   count(*)::text FROM public.channel_fields
  UNION ALL SELECT 8, 'rowcount', 'tasks',            count(*)::text FROM public.tasks
  UNION ALL SELECT 8, 'rowcount', 'task_assignments', count(*)::text FROM public.task_assignments
  UNION ALL SELECT 8, 'rowcount', 'checklist_items',  count(*)::text FROM public.checklist_items
  UNION ALL SELECT 8, 'rowcount', 'task_comments',    count(*)::text FROM public.task_comments
  UNION ALL SELECT 8, 'rowcount', 'notifications',    count(*)::text FROM public.notifications
  UNION ALL SELECT 8, 'rowcount', 'mentions',         count(*)::text FROM public.mentions
  UNION ALL SELECT 8, 'rowcount', 'pending_mentions', count(*)::text FROM public.pending_mentions
  UNION ALL SELECT 8, 'rowcount', 'activity_log',     count(*)::text FROM public.activity_log
  UNION ALL SELECT 8, 'rowcount', 'budget_periods',   count(*)::text FROM public.budget_periods

  UNION ALL

  -- 9. RLS policies on `tasks` (we already know these look healthy)
  SELECT 9, 'tasks_policy', policyname, cmd
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'tasks'
)
SELECT section, metric, detail, value
FROM diag
ORDER BY section, detail NULLS LAST;
