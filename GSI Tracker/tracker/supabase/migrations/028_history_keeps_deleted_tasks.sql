-- 028: History records task deletions and keeps a deleted task's past entries.
-- Idempotent.
--
-- Before: activity_log.task_id was ON DELETE CASCADE, so deleting a task
-- erased its whole history, and no "deleted" entry was ever written.
-- After: the link is set to NULL instead (entries survive), and a trigger
-- writes a 'deleted' entry carrying the task's title and where it lived.
-- Deletions made before this migration are already gone and can't be recovered.

-- 1) Keep history rows when their task is deleted.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'public.activity_log'::regclass AND contype = 'f'
    AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.activity_log'::regclass AND attname = 'task_id')];
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.activity_log DROP CONSTRAINT %I', c);
  END IF;
END $$;
ALTER TABLE public.activity_log
  ADD CONSTRAINT activity_log_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;

-- 2) Log every deletion (sub-tasks removed with their parent are logged too).
CREATE OR REPLACE FUNCTION public.log_task_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO activity_log (task_id, actor_id, action, from_value, to_value)
  VALUES (NULL, auth.uid(), 'deleted',
          jsonb_build_object('task_id', OLD.id, 'title', OLD.title, 'channel_id', OLD.channel_id,
                             'parent_task_id', OLD.parent_task_id, 'status', OLD.status,
                             'priority', OLD.priority, 'due_date', OLD.due_date),
          NULL);
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS tasks_log_delete ON public.tasks;
CREATE TRIGGER tasks_log_delete
  AFTER DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_delete();

-- 3) Verify: the link now says SET NULL ('n') and the trigger exists.
SELECT
  (SELECT confdeltype FROM pg_constraint WHERE conname = 'activity_log_task_id_fkey') AS on_delete_rule,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'tasks_log_delete') AS delete_trigger;
