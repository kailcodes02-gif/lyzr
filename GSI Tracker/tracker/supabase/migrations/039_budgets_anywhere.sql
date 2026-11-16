-- ============================================================
-- Migration 039 — budgets anywhere
--
-- One budget is one amount of money set against one thing:
--   a campaign (launch, thunderclap…), a channel, a product or a vertical.
-- Budgets are horizontal: the same task can count toward its campaign's
-- budget, its channel's and its product's at once, so budgets of different
-- kinds are never added together.
--
--   cadence   one_time  the amount covers starts_on..ends_on (or all time)
--             monthly / quarterly / yearly  the amount is per period,
--             from starts_on until ends_on (open-ended when NULL)
--   planned   = what tasks in that scope have in tasks.budget_allocated,
--             counted by the task's due date. Worked out in the app.
--
-- Who can add or change a budget: admins, leadership, and the head of the
-- thing it is for (vertical head, product head, campaign owner, channel or
-- domain head incl. the head of a parent channel). Everyone can read.
--
-- The old budget_periods rows (seeded monthly channel amounts from the GTM
-- blueprint) are copied across onto the channels they were merged into in
-- 036, then removed where no task points at them. Safe to run again.
-- ============================================================

CREATE TABLE IF NOT EXISTS budgets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('campaign', 'channel', 'product', 'vertical')),
  scope_id    UUID NOT NULL,
  name        TEXT,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  cadence     TEXT NOT NULL DEFAULT 'one_time' CHECK (cadence IN ('one_time', 'monthly', 'quarterly', 'yearly')),
  starts_on   DATE,
  ends_on     DATE,
  notes       TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS budgets_scope_idx ON budgets(scope_type, scope_id);

CREATE OR REPLACE FUNCTION public.is_leadership() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u JOIN leadership_emails l
      ON lower(l.email) IN (lower(u.email), lower(COALESCE(u.alt_email, '')))
     WHERE u.id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.is_leadership() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_manage_budget(st TEXT, sid UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT is_admin() OR is_leadership() OR CASE st
    WHEN 'vertical' THEN is_vertical_owner(sid)
    WHEN 'product'  THEN is_product_owner(sid)
    WHEN 'campaign' THEN is_campaign_owner(sid)
    WHEN 'channel'  THEN EXISTS (
      SELECT 1 FROM channels c JOIN effective_channel_owners o
        ON o.channel_id IN (c.id, c.parent_channel_id)
       WHERE c.id = sid AND o.user_id = auth.uid())
    ELSE false END;
$$;
GRANT EXECUTE ON FUNCTION public.can_manage_budget(TEXT, UUID) TO authenticated, service_role;

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budgets_read ON budgets;
CREATE POLICY budgets_read ON budgets FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS budgets_manage ON budgets;
CREATE POLICY budgets_manage ON budgets FOR ALL TO authenticated
  USING (can_manage_budget(scope_type, scope_id)) WITH CHECK (can_manage_budget(scope_type, scope_id));
GRANT ALL ON budgets TO authenticated, service_role;

-- History: who set, changed or removed a budget.
CREATE OR REPLACE FUNCTION public.log_budget_change() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; nm TEXT; act TEXT;
BEGIN
  IF lyzr_quiet() THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.amount = OLD.amount AND NEW.cadence = OLD.cadence
     AND NEW.starts_on IS NOT DISTINCT FROM OLD.starts_on AND NEW.ends_on IS NOT DISTINCT FROM OLD.ends_on THEN RETURN NULL; END IF;
  nm := CASE r.scope_type
    WHEN 'campaign' THEN (SELECT name FROM campaigns WHERE id = r.scope_id)
    WHEN 'channel'  THEN (SELECT name FROM channels  WHERE id = r.scope_id)
    WHEN 'product'  THEN (SELECT name FROM products  WHERE id = r.scope_id)
    WHEN 'vertical' THEN (SELECT name FROM verticals WHERE id = r.scope_id) END;
  act := CASE TG_OP WHEN 'INSERT' THEN 'budget_set' WHEN 'UPDATE' THEN 'budget_changed' ELSE 'budget_removed' END;
  INSERT INTO activity_log (actor_id, action, entity_type, entity_id, label, from_value, to_value,
                            channel_id, campaign_id, vertical_ids, product_ids)
  VALUES (auth.uid(), act, 'budget', r.id, COALESCE(nm, r.scope_type),
          CASE WHEN TG_OP <> 'INSERT' THEN jsonb_build_object('amount', OLD.amount, 'cadence', OLD.cadence) END,
          CASE WHEN TG_OP <> 'DELETE' THEN jsonb_build_object('amount', NEW.amount, 'cadence', NEW.cadence, 'scope', NEW.scope_type) END,
          CASE WHEN r.scope_type = 'channel'  THEN r.scope_id END,
          CASE WHEN r.scope_type = 'campaign' THEN r.scope_id END,
          CASE WHEN r.scope_type = 'vertical' THEN ARRAY[r.scope_id] ELSE '{}'::uuid[] END,
          CASE WHEN r.scope_type = 'product'  THEN ARRAY[r.scope_id] ELSE '{}'::uuid[] END);
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS budgets_log ON budgets;
CREATE TRIGGER budgets_log AFTER INSERT OR UPDATE OR DELETE ON budgets FOR EACH ROW EXECUTE FUNCTION log_budget_change();

CREATE OR REPLACE FUNCTION public.budgets_touch() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS budgets_touch_trg ON budgets;
CREATE TRIGGER budgets_touch_trg BEFORE UPDATE ON budgets FOR EACH ROW EXECUTE FUNCTION budgets_touch();

-- ---------- carry the old channel budgets across ----------
DO $$
DECLARE b RECORD; keep UUID; hop INT;
BEGIN
  PERFORM set_config('lyzr.quiet', 'on', true);
  FOR b IN SELECT * FROM budget_periods WHERE scope_type::text = 'channel' AND scope_id IS NOT NULL LOOP
    -- follow 036's merges to the channel that is live today
    keep := b.scope_id; hop := 0;
    WHILE hop < 6 AND EXISTS (SELECT 1 FROM channels c WHERE c.id = keep AND NOT c.is_active AND c.extra ? 'merged_into') LOOP
      SELECT (c.extra->>'merged_into')::uuid INTO keep FROM channels c WHERE c.id = keep; hop := hop + 1;
    END LOOP;
    IF keep IS NULL OR NOT EXISTS (SELECT 1 FROM channels c WHERE c.id = keep AND c.is_active) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM budgets x WHERE x.scope_type = 'channel' AND x.scope_id = keep AND x.notes LIKE '%[from ' || b.id || ']') THEN CONTINUE; END IF;
    INSERT INTO budgets (scope_type, scope_id, name, amount, cadence, starts_on, ends_on, notes, created_by, created_at)
    VALUES ('channel', keep,
            (SELECT c.name FROM channels c WHERE c.id = b.scope_id),
            b.total_budget,
            CASE b.period_type::text WHEN 'monthly' THEN 'monthly' WHEN 'quarterly' THEN 'quarterly' WHEN 'yearly' THEN 'yearly' WHEN 'annual' THEN 'yearly' ELSE 'one_time' END,
            b.starts_on,
            CASE WHEN b.period_type::text IN ('monthly', 'quarterly', 'yearly', 'annual') THEN NULL ELSE b.ends_on END,
            COALESCE(b.notes, 'Carried over') || ' [from ' || b.id || ']', b.created_by, b.created_at);
  END LOOP;
  -- the old rows are now duplicates; keep any a task still points at
  DELETE FROM budget_periods bp WHERE bp.scope_type::text = 'channel'
    AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.budget_period_id = bp.id)
    AND EXISTS (SELECT 1 FROM budgets x WHERE x.notes LIKE '%[from ' || bp.id || ']');
  PERFORM set_config('lyzr.quiet', 'off', true);
END $$;

-- ---------- what to check ----------
SELECT b.scope_type, COALESCE(c.name, p.name, v.name, k.name) AS for_what, b.name AS was, b.amount, b.cadence, b.starts_on, b.ends_on
  FROM budgets b
  LEFT JOIN channels c  ON b.scope_type = 'channel'  AND c.id = b.scope_id
  LEFT JOIN products p  ON b.scope_type = 'product'  AND p.id = b.scope_id
  LEFT JOIN verticals v ON b.scope_type = 'vertical' AND v.id = b.scope_id
  LEFT JOIN campaigns k ON b.scope_type = 'campaign' AND k.id = b.scope_id
 ORDER BY 1, 2;
