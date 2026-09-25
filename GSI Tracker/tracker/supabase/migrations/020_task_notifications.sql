-- ============================================================
-- Migration 020: notifications for everything that happens on a task.
-- Written by database triggers so no client path can skip them.
-- "Related people" of a task = its owners, its creator, the owners of its
-- parent task, the owners of its channel (effective, incl. domain owners),
-- and anyone who suggested an edit on it. The actor never notifies themself.
-- Idempotent; safe to paste on the live DB. Run AFTER 019.
-- ============================================================

-- New kinds. (ADD VALUE cannot be used by other statements in the same
-- transaction; the trigger bodies below are only compiled at run time.)
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'task_edited';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'checklist';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'subtask_added';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'suggestion';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'suggestion_resolved';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'campaign_ask';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'task_created';

-- Everyone who should hear about task t.
CREATE OR REPLACE FUNCTION public.task_watchers(t UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT u FROM (
    SELECT user_id AS u FROM task_assignments WHERE task_id = t
    UNION SELECT created_by FROM tasks WHERE id = t
    UNION SELECT a.user_id FROM tasks x JOIN task_assignments a ON a.task_id = x.parent_task_id WHERE x.id = t
    UNION SELECT o.user_id FROM tasks x JOIN effective_channel_owners o ON o.channel_id = x.channel_id WHERE x.id = t
    UNION SELECT o.user_id FROM tasks x JOIN channels c ON c.id = x.channel_id JOIN effective_channel_owners o ON o.channel_id = c.parent_channel_id WHERE x.id = t
    UNION SELECT suggested_by FROM task_suggestions WHERE task_id = t
  ) w WHERE u IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.task_watchers(UUID) TO authenticated, service_role;

-- Insert one notification per watcher (minus the actor), deduped within 10s
-- so a client that still inserts its own copy does not double up.
CREATE OR REPLACE FUNCTION public.notify_task(t UUID, kind TEXT, payload JSONB, actor UUID, only_users UUID[] DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r UUID; title TEXT;
BEGIN
  SELECT x.title INTO title FROM tasks x WHERE x.id = t;
  FOR r IN SELECT * FROM unnest(COALESCE(only_users, ARRAY(SELECT task_watchers(t)))) LOOP
    IF r IS NULL OR r = actor THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = r AND n.task_id = t AND n.type::text = kind AND n.created_at > now() - interval '10 seconds') THEN CONTINUE; END IF;
    INSERT INTO notifications (user_id, task_id, type, payload)
    VALUES (r, t, kind::notification_type, payload || jsonb_build_object('task_title', title, 'actor_id', actor));
  END LOOP;
END; $$;

-- ---- comments ----
CREATE OR REPLACE FUNCTION public.trg_notify_comment() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM notify_task(NEW.task_id, 'comment', jsonb_build_object('comment_body', left(NEW.body, 140), 'commented_by', NEW.user_id), NEW.user_id);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS task_comments_notify ON task_comments;
CREATE TRIGGER task_comments_notify AFTER INSERT ON task_comments FOR EACH ROW EXECUTE FUNCTION trg_notify_comment();

-- ---- checklist ----
CREATE OR REPLACE FUNCTION public.trg_notify_checklist() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM notify_task(NEW.task_id, 'checklist', jsonb_build_object('item', left(NEW.body, 120), 'action', 'added'), COALESCE(auth.uid(), NEW.created_by));
  ELSIF NEW.is_done IS DISTINCT FROM OLD.is_done THEN
    PERFORM notify_task(NEW.task_id, 'checklist', jsonb_build_object('item', left(NEW.body, 120), 'action', CASE WHEN NEW.is_done THEN 'done' ELSE 'reopened' END), COALESCE(auth.uid(), NEW.done_by));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS checklist_items_notify ON checklist_items;
CREATE TRIGGER checklist_items_notify AFTER INSERT OR UPDATE ON checklist_items FOR EACH ROW EXECUTE FUNCTION trg_notify_checklist();

-- ---- tasks: created (sub-task under a parent, or on a channel you own) + edited ----
CREATE OR REPLACE FUNCTION public.trg_notify_task_insert() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.parent_task_id IS NOT NULL THEN
    PERFORM notify_task(NEW.parent_task_id, 'subtask_added', jsonb_build_object('subtask_id', NEW.id, 'subtask_title', NEW.title), COALESCE(auth.uid(), NEW.created_by));
  ELSE
    -- channel owners hear about new work on their board
    PERFORM notify_task(NEW.id, 'task_created', jsonb_build_object('channel_id', NEW.channel_id), COALESCE(auth.uid(), NEW.created_by));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tasks_notify_insert ON tasks;
CREATE TRIGGER tasks_notify_insert AFTER INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION trg_notify_task_insert();

-- Re-declare the 019 history trigger so one UPDATE also produces one
-- 'task_edited' notification listing the changed fields (status excluded:
-- the client already sends 'status_change').
CREATE OR REPLACE FUNCTION public.log_task_edit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f TEXT; changed TEXT[] := '{}';
  fields TEXT[] := ARRAY['title','description','priority','status','due_date','channel_id','parent_task_id',
                         'budget_allocated','budget_period_id','campaign_id','result_url','blocked_reason','blocked_by_email',
                         'planning_fields','tracker_fields'];
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

-- ---- suggestions ----
CREATE OR REPLACE FUNCTION public.trg_notify_suggestion() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM notify_task(NEW.task_id, 'suggestion', jsonb_build_object('suggestion_id', NEW.id, 'fields', (SELECT to_jsonb(array_agg(k)) FROM jsonb_object_keys(NEW.patch) k), 'note', NEW.note), NEW.suggested_by);
  ELSIF NEW.status <> OLD.status AND NEW.status IN ('accepted', 'rejected') THEN
    PERFORM notify_task(NEW.task_id, 'suggestion_resolved', jsonb_build_object('suggestion_id', NEW.id, 'result', NEW.status), COALESCE(auth.uid(), NEW.resolved_by), ARRAY[NEW.suggested_by]);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS task_suggestions_notify ON task_suggestions;
CREATE TRIGGER task_suggestions_notify AFTER INSERT OR UPDATE ON task_suggestions FOR EACH ROW EXECUTE FUNCTION trg_notify_suggestion();

-- ---- assignments: "somebody asks you for a task" ----
CREATE OR REPLACE FUNCTION public.trg_notify_assignment() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM notify_task(NEW.task_id, 'assigned', jsonb_build_object('role', NEW.role, 'assigned_by', NEW.assigned_by), COALESCE(auth.uid(), NEW.assigned_by), ARRAY[NEW.user_id]);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS task_assignments_notify ON task_assignments;
CREATE TRIGGER task_assignments_notify AFTER INSERT ON task_assignments FOR EACH ROW EXECUTE FUNCTION trg_notify_assignment();

-- ---- thunderclap: you have been asked to do something ----
CREATE OR REPLACE FUNCTION public.trg_notify_participant() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c RECORD;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  SELECT name, ask, kind INTO c FROM campaigns WHERE id = NEW.campaign_id;
  IF auth.uid() IS DISTINCT FROM NEW.user_id THEN
    INSERT INTO notifications (user_id, task_id, type, payload)
    VALUES (NEW.user_id, NULL, 'campaign_ask'::notification_type, jsonb_build_object('campaign_id', NEW.campaign_id, 'campaign_name', c.name, 'ask', c.ask, 'kind', c.kind));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS campaign_participants_notify ON campaign_participants;
CREATE TRIGGER campaign_participants_notify AFTER INSERT ON campaign_participants FOR EACH ROW EXECUTE FUNCTION trg_notify_participant();

-- Users may delete their own notifications (clear list).
DROP POLICY IF EXISTS "notifications_delete" ON notifications;
CREATE POLICY "notifications_delete" ON notifications FOR DELETE TO authenticated USING (auth.uid() = user_id);
