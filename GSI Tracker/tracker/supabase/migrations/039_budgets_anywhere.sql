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
-- Actual spend is logged against a budget as dated entries (budget_spends):
-- "assigned" is the budget's amount, "spent" is the running sum of entries.
-- The same people who may set a budget may log spend against it.
--
-- The old budget_periods rows (monthly channel amounts seeded from the GTM
-- blueprint, now out of date) are removed, except any a task points at.
-- Nothing is carried over: budgets start empty. Safe to run again.
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

-- ---------- actual spend, logged against a budget ----------
CREATE TABLE IF NOT EXISTS budget_spends (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id   UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount <> 0),   -- negative = a refund or correction
  spent_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  note        TEXT,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS budget_spends_budget_idx ON budget_spends(budget_id, spent_on);

ALTER TABLE budget_spends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_spends_read ON budget_spends;
CREATE POLICY budget_spends_read ON budget_spends FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS budget_spends_manage ON budget_spends;
CREATE POLICY budget_spends_manage ON budget_spends FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_id AND can_manage_budget(b.scope_type, b.scope_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_id AND can_manage_budget(b.scope_type, b.scope_id)));
GRANT ALL ON budget_spends TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.log_budget_spend() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; b RECORD; nm TEXT;
BEGIN
  IF lyzr_quiet() THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT * INTO b FROM budgets WHERE id = r.budget_id;
  IF NOT FOUND THEN RETURN NULL; END IF;   -- the budget itself is being removed
  nm := CASE b.scope_type
    WHEN 'campaign' THEN (SELECT name FROM campaigns WHERE id = b.scope_id)
    WHEN 'channel'  THEN (SELECT name FROM channels  WHERE id = b.scope_id)
    WHEN 'product'  THEN (SELECT name FROM products  WHERE id = b.scope_id)
    WHEN 'vertical' THEN (SELECT name FROM verticals WHERE id = b.scope_id) END;
  INSERT INTO activity_log (actor_id, action, entity_type, entity_id, label, to_value,
                            channel_id, campaign_id, vertical_ids, product_ids)
  VALUES (auth.uid(), CASE TG_OP WHEN 'DELETE' THEN 'spend_removed' ELSE 'spend_logged' END, 'budget', b.id, COALESCE(nm, b.scope_type),
          jsonb_build_object('amount', r.amount, 'spent_on', r.spent_on, 'note', r.note),
          CASE WHEN b.scope_type = 'channel'  THEN b.scope_id END,
          CASE WHEN b.scope_type = 'campaign' THEN b.scope_id END,
          CASE WHEN b.scope_type = 'vertical' THEN ARRAY[b.scope_id] ELSE '{}'::uuid[] END,
          CASE WHEN b.scope_type = 'product'  THEN ARRAY[b.scope_id] ELSE '{}'::uuid[] END);
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS budget_spends_log ON budget_spends;
CREATE TRIGGER budget_spends_log AFTER INSERT OR DELETE ON budget_spends FOR EACH ROW EXECUTE FUNCTION log_budget_spend();

-- ---------- remove the old, out-of-date budgets ----------
DELETE FROM budget_periods bp WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.budget_period_id = bp.id);

-- The "$3,000 / mo" style notes printed beside channel names came from the
-- same blueprint and are out of date too. Cleared quietly (no history rows).
DO $$
BEGIN
  PERFORM set_config('lyzr.quiet', 'on', true);
  UPDATE channels SET budget_note = NULL WHERE budget_note IS NOT NULL;
  PERFORM set_config('lyzr.quiet', 'off', true);
END $$;

-- ---------- what to check (one row) ----------
SELECT
  (SELECT count(*) FROM budgets)        AS budgets,            -- 0 on the first run
  (SELECT count(*) FROM budget_spends)  AS spend_entries,      -- 0 on the first run
  (SELECT count(*) FROM budget_periods) AS old_budgets_left,   -- 0
  (SELECT count(*) FROM channels WHERE budget_note IS NOT NULL) AS old_channel_budget_notes_left;   -- 0
