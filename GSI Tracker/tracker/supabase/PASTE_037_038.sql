-- ============================================================
-- Migration 037 — guest logins
-- A short, admin-managed list of non-Lyzr emails that may hold a tracker
-- account (they sign in with email + password). Everyone else must still
-- be @lyzr.com. Safe to run more than once.
-- ============================================================
CREATE TABLE IF NOT EXISTS guest_emails (
  email      TEXT PRIMARY KEY,
  note       TEXT,
  added_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE guest_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guest_emails_read ON guest_emails;
CREATE POLICY guest_emails_read ON guest_emails FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS guest_emails_manage ON guest_emails;
CREATE POLICY guest_emails_manage ON guest_emails FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

INSERT INTO guest_emails (email, note) VALUES ('isha@whitepath.in', 'Whitepath') ON CONFLICT DO NOTHING;

-- Sign-up guard: @lyzr.com, or an email on the guest list.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  em TEXT := lower(NEW.email); twin TEXT := lyzr_twin(NEW.email); md JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb); nm TEXT; av TEXT; existing TEXT;
BEGIN
  IF em IS NULL OR NOT (em LIKE '%@lyzr.com' OR EXISTS (SELECT 1 FROM guest_emails g WHERE lower(g.email) = em)) THEN
    RAISE EXCEPTION 'Only lyzr.com Microsoft accounts can sign in to the tracker (%)', em USING ERRCODE = '42501';
  END IF;
  SELECT email INTO existing FROM public.users WHERE lower(email) = twin OR lower(alt_email) = em LIMIT 1;
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'You already have a tracker account as %. Ask an admin to move it to your lyzr.com address.', existing USING ERRCODE = '42501';
  END IF;
  nm := COALESCE(NULLIF(md->>'full_name', ''), NULLIF(md->>'name', ''), NULLIF(md->>'preferred_username', ''), split_part(em, '@', 1));
  av := COALESCE(NULLIF(md->>'avatar_url', ''), NULLIF(md->>'picture', ''));
  INSERT INTO public.users (id, email, display_name, avatar_url, role)
  VALUES (NEW.id, NEW.email, nm, av, CASE WHEN EXISTS (SELECT 1 FROM admin_emails a WHERE lower(a.email) IN (em, twin)) THEN 'admin'::user_role ELSE 'member'::user_role END);
  UPDATE pending_mentions SET resolved_user_id = NEW.id, resolved_at = now() WHERE lower(email) IN (em, twin) AND resolved_user_id IS NULL;
  INSERT INTO mentions (task_id, surface, surface_ref_id, mentioned_user_id, mentioned_email, mentioned_by)
  SELECT pm.task_id, pm.surface, pm.surface_ref_id, NEW.id, NEW.email, NEW.id FROM pending_mentions pm WHERE lower(pm.email) IN (em, twin) AND pm.resolved_user_id = NEW.id;
  UPDATE pending_invites SET resolved_user_id = NEW.id, resolved_at = now() WHERE lower(email) IN (em, twin) AND resolved_user_id IS NULL;
  INSERT INTO task_assignments (task_id, user_id, role, assigned_by)
  SELECT pa.task_id, NEW.id, CASE WHEN pa.role = 'primary' AND EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = pa.task_id AND ta.role = 'primary') THEN 'secondary'::assignment_role ELSE pa.role END, pa.assigned_by
    FROM pending_assignments pa WHERE lower(pa.email) IN (em, twin) AND pa.resolved_user_id IS NULL ON CONFLICT (task_id, user_id) DO NOTHING;
  UPDATE pending_assignments SET resolved_user_id = NEW.id, resolved_at = now() WHERE lower(email) IN (em, twin) AND resolved_user_id IS NULL;
  UPDATE channel_owners SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE vertical_owners SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE vertical_members SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE function_owners SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE campaign_owners SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE campaign_participants SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  RETURN NEW;
END; $$;

SELECT email, note FROM guest_emails;
-- ============================================================
-- Migration 038 — ask and reply, co-assignees, personal links
--
--  1. Every task keeps two pairs of values:
--       requested_priority / requested_due_date   what "Assigned by" asked for
--       replied_priority   / replied_due_date     what "Assigned to" came back with
--     tasks.priority and tasks.due_date stay the values every board, calendar
--     and report already reads: the reply once there is one, the ask until then.
--     reply_to_task() is how the assignee answers; the person who assigned it
--     gets a 'task_reply' notification and History gets a 'replied' row.
--  2. Roles on a task: primary = Assigned to (the primary person),
--     secondary = also Assigned to, other = Contributor. Rows that were
--     "contributor" under the old wording (secondary) move to 'other' once.
--  3. users.handle: the short name in a person's link (/u/?who=mothilal).
--
-- Safe to run more than once. Run AFTER 036 (037 can come before or after).
-- ============================================================

-- New notification kind. Only used inside function bodies below, which are
-- compiled when they first run, so this is fine in one script.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'task_reply';

-- ---------- 1. columns + one-time backfill ----------
DO $$
DECLARE first_run BOOLEAN := NOT EXISTS (
  SELECT 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'requested_priority');
BEGIN
  IF first_run THEN
    ALTER TABLE tasks
      ADD COLUMN requested_priority task_priority,
      ADD COLUMN requested_due_date DATE,
      ADD COLUMN replied_priority   task_priority,
      ADD COLUMN replied_due_date   DATE,
      ADD COLUMN replied_at         TIMESTAMPTZ,
      ADD COLUMN replied_by         UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN reply_note         TEXT;

    ALTER TABLE tasks DISABLE TRIGGER USER;
    ALTER TABLE task_assignments DISABLE TRIGGER USER;
    -- Existing tasks: what they have now counts as both asked and agreed, so
    -- nobody gets a backlog of old tasks to reply to.
    UPDATE tasks SET requested_priority = priority, requested_due_date = due_date,
                     replied_priority = priority,   replied_due_date = due_date,
                     replied_at = created_at;
    -- Old wording: secondary meant "contributor". It now means "also assigned to".
    UPDATE task_assignments    SET role = 'other' WHERE role IN ('secondary', 'tertiary');
    UPDATE pending_assignments SET role = 'other' WHERE role IN ('secondary', 'tertiary');
    ALTER TABLE task_assignments ENABLE TRIGGER USER;
    ALTER TABLE tasks ENABLE TRIGGER USER;
  END IF;
END $$;

-- ---------- 2. keep the ask in step with the task ----------
-- Set by reply_to_task() and the assignment trigger while they write the
-- reply columns themselves.
CREATE OR REPLACE FUNCTION public.lyzr_replying() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('lyzr.reply', true), '') = 'on';
$$;

CREATE OR REPLACE FUNCTION public.tasks_ask_on_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.requested_priority := COALESCE(NEW.requested_priority, NEW.priority);
  NEW.requested_due_date := COALESCE(NEW.requested_due_date, NEW.due_date);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tasks_ask_insert ON tasks;
CREATE TRIGGER tasks_ask_insert BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION tasks_ask_on_insert();

-- Someone edits priority or due date straight on the task (drawer, calendar
-- drag, bulk edit). Who they are decides which side of the pair moves:
--   the primary assignee          -> that is their reply
--   nobody to negotiate with      -> ask and reply move together
--   anyone else (the requester…)  -> a new ask; the old reply no longer stands
CREATE OR REPLACE FUNCTION public.tasks_ask_on_update() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID := auth.uid(); prim UUID;
BEGIN
  IF lyzr_replying() THEN RETURN NEW; END IF;
  IF NEW.priority IS NOT DISTINCT FROM OLD.priority AND NEW.due_date IS NOT DISTINCT FROM OLD.due_date THEN RETURN NEW; END IF;
  SELECT user_id INTO prim FROM task_assignments WHERE task_id = NEW.id AND role = 'primary' LIMIT 1;
  IF prim IS NULL OR prim = NEW.created_by OR me IS NULL THEN
    NEW.requested_priority := NEW.priority; NEW.requested_due_date := NEW.due_date;
    NEW.replied_priority := NEW.priority;   NEW.replied_due_date := NEW.due_date;
    IF prim IS NOT NULL AND NEW.replied_at IS NULL THEN NEW.replied_at := now(); NEW.replied_by := prim; END IF;
  ELSIF me = prim THEN
    NEW.replied_priority := NEW.priority; NEW.replied_due_date := NEW.due_date;
    NEW.replied_at := now(); NEW.replied_by := me;
  ELSE
    NEW.requested_priority := NEW.priority; NEW.requested_due_date := NEW.due_date;
    NEW.replied_priority := NULL; NEW.replied_due_date := NULL;
    NEW.replied_at := NULL; NEW.replied_by := NULL; NEW.reply_note := NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tasks_ask_update ON tasks;
CREATE TRIGGER tasks_ask_update BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION tasks_ask_on_update();

-- A primary assignee arrives. If they assigned it to themself there is nothing
-- to reply to. If the task changes hands, the previous person's reply goes and
-- the task shows what was asked again.
CREATE OR REPLACE FUNCTION public.tasks_ask_on_primary() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x RECORD;
BEGIN
  IF NEW.role <> 'primary' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.role = 'primary' AND OLD.user_id = NEW.user_id THEN RETURN NEW; END IF;
  SELECT created_by, requested_priority, requested_due_date, priority, due_date, replied_at, replied_by INTO x FROM tasks WHERE id = NEW.task_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM set_config('lyzr.reply', 'on', true);
  IF NEW.user_id = x.created_by THEN
    IF x.replied_at IS NULL THEN
      UPDATE tasks SET replied_priority = priority, replied_due_date = due_date, replied_at = now(), replied_by = NEW.user_id WHERE id = NEW.task_id;
    END IF;
  ELSIF x.replied_by IS NOT NULL AND x.replied_by <> NEW.user_id THEN
    UPDATE tasks SET priority = COALESCE(requested_priority, priority), due_date = requested_due_date,
                     replied_priority = NULL, replied_due_date = NULL, replied_at = NULL, replied_by = NULL, reply_note = NULL
     WHERE id = NEW.task_id;
  END IF;
  PERFORM set_config('lyzr.reply', 'off', true);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS task_assignments_ask ON task_assignments;
CREATE TRIGGER task_assignments_ask AFTER INSERT OR UPDATE OF role, user_id ON task_assignments FOR EACH ROW EXECUTE FUNCTION tasks_ask_on_primary();

-- ---------- 3. the reply ----------
-- Accept as asked: pass the requested values back. Propose: pass your own.
-- Either way the task now runs on the replied values.
CREATE OR REPLACE FUNCTION public.reply_to_task(t UUID, p task_priority, d DATE, note TEXT DEFAULT NULL)
RETURNS tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID := auth.uid(); x tasks; out tasks; accepted BOOLEAN; r UUID;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501'; END IF;
  SELECT * INTO x FROM tasks WHERE id = t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF NOT (is_admin() OR EXISTS (SELECT 1 FROM task_assignments a WHERE a.task_id = t AND a.user_id = me AND a.role IN ('primary', 'secondary'))) THEN
    RAISE EXCEPTION 'Only the people this task is assigned to can reply' USING ERRCODE = '42501';
  END IF;
  IF d IS NULL THEN RAISE EXCEPTION 'A reply needs a due date'; END IF;
  accepted := p = COALESCE(x.requested_priority, x.priority) AND d IS NOT DISTINCT FROM COALESCE(x.requested_due_date, x.due_date);

  PERFORM set_config('lyzr.reply', 'on', true);
  UPDATE tasks SET priority = p, due_date = d,
                   requested_priority = COALESCE(requested_priority, x.priority),
                   requested_due_date = COALESCE(requested_due_date, x.due_date),
                   replied_priority = p, replied_due_date = d, replied_at = now(), replied_by = me,
                   reply_note = NULLIF(btrim(COALESCE(note, '')), '')
   WHERE id = t RETURNING * INTO out;
  PERFORM set_config('lyzr.reply', 'off', true);

  INSERT INTO activity_log (task_id, actor_id, action, from_value, to_value)
  VALUES (t, me, 'replied',
          jsonb_build_object('priority', out.requested_priority, 'due_date', out.requested_due_date),
          jsonb_build_object('priority', p, 'due_date', d, 'accepted', accepted, 'note', out.reply_note));

  -- Tell whoever assigned it, and the other people it is assigned to. They
  -- get this instead of the generic "task edited" the same update produced.
  FOR r IN SELECT DISTINCT u FROM (
             SELECT x.created_by AS u
             UNION SELECT a.user_id FROM task_assignments a WHERE a.task_id = t AND a.role IN ('primary', 'secondary')
           ) w WHERE u IS NOT NULL AND u <> me LOOP
    DELETE FROM notifications n WHERE n.user_id = r AND n.task_id = t AND n.type::text = 'task_edited' AND n.created_at >= transaction_timestamp();
    INSERT INTO notifications (user_id, task_id, type, payload)
    VALUES (r, t, 'task_reply'::notification_type, jsonb_build_object(
      'task_title', out.title, 'actor_id', me, 'accepted', accepted,
      'requested_priority', out.requested_priority, 'requested_due_date', out.requested_due_date,
      'replied_priority', p, 'replied_due_date', d, 'note', out.reply_note));
  END LOOP;
  RETURN out;
END; $$;
GRANT EXECUTE ON FUNCTION public.reply_to_task(UUID, task_priority, DATE, TEXT) TO authenticated;

-- ---------- 4. personal link handles ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_uq ON users (lower(handle));

-- mothilal.kanagaraj@lyzr.com -> "mothilal"; if taken, "mothilal-kanagaraj";
-- if that is taken too, a number on the end.
CREATE OR REPLACE FUNCTION public.make_handle(em TEXT, uid UUID) RETURNS TEXT LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE loc TEXT := split_part(lower(COALESCE(em, '')), '@', 1); cand TEXT; n INT := 1;
  short TEXT := regexp_replace(split_part(loc, '.', 1), '[^a-z0-9]', '', 'g');
  full_ TEXT := btrim(regexp_replace(loc, '[^a-z0-9]+', '-', 'g'), '-');
BEGIN
  IF short = '' THEN short := 'user'; END IF;
  IF full_ = '' THEN full_ := short; END IF;
  cand := short;
  IF EXISTS (SELECT 1 FROM users u WHERE lower(u.handle) = cand AND u.id IS DISTINCT FROM uid) THEN cand := full_; END IF;
  WHILE EXISTS (SELECT 1 FROM users u WHERE lower(u.handle) = cand AND u.id IS DISTINCT FROM uid) LOOP
    n := n + 1; cand := full_ || n::text;
  END LOOP;
  RETURN cand;
END; $$;

CREATE OR REPLACE FUNCTION public.users_set_handle() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.handle IS NULL OR btrim(NEW.handle) = '' THEN NEW.handle := make_handle(NEW.email, NEW.id); END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS users_handle_default ON public.users;
CREATE TRIGGER users_handle_default BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION users_set_handle();

DO $$
DECLARE u RECORD;
BEGIN
  FOR u IN SELECT id, email FROM users WHERE handle IS NULL OR btrim(handle) = '' ORDER BY created_at, email LOOP
    UPDATE users SET handle = make_handle(u.email, u.id) WHERE id = u.id;
  END LOOP;
END $$;

-- Change your own link name. Letters, numbers and dashes; 2 to 30 characters.
CREATE OR REPLACE FUNCTION public.set_my_handle(h TEXT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me UUID := auth.uid(); clean TEXT := lower(btrim(COALESCE(h, '')));
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501'; END IF;
  IF clean !~ '^[a-z0-9][a-z0-9-]{1,29}$' THEN RAISE EXCEPTION 'Use 2 to 30 letters, numbers or dashes'; END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE lower(u.handle) = clean AND u.id <> me) THEN RAISE EXCEPTION 'That name is taken'; END IF;
  UPDATE users SET handle = clean WHERE id = me;
  RETURN clean;
END; $$;
GRANT EXECUTE ON FUNCTION public.set_my_handle(TEXT) TO authenticated;

-- ---------- 5. what to check (one row) ----------
SELECT
  (SELECT count(*) FROM tasks)                                                    AS tasks,
  (SELECT count(*) FROM tasks WHERE requested_priority IS NULL)                   AS tasks_without_an_ask,       -- 0
  (SELECT count(*) FROM tasks WHERE replied_at IS NULL)                           AS tasks_awaiting_reply,       -- 0 right after the first run
  (SELECT count(*) FROM users WHERE handle IS NULL)                               AS people_without_a_link,      -- 0
  (SELECT count(*) FROM task_assignments WHERE role = 'primary')                  AS primary_assignees,
  (SELECT count(*) FROM task_assignments WHERE role = 'other')                    AS contributors;
