-- ============================================================
-- Migration 012: Google-Calendar-style recurrence
-- Adds "repeat every N day/week/month", specific weekdays for weekly
-- recurrence, and an explicit end condition (never / on date / after N
-- occurrences) to recurring_templates. The old pattern/custom_interval_days/
-- ends_on columns are kept (still NOT NULL) and are written as a best-fit
-- label for backward compatibility, but are no longer used for date math.
-- Idempotent. Safe to re-run. PASTE INTO SUPABASE SQL EDITOR.
-- ============================================================

ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS interval_count INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS interval_unit TEXT NOT NULL DEFAULT 'week',
  ADD COLUMN IF NOT EXISTS by_weekdays SMALLINT[],
  ADD COLUMN IF NOT EXISTS end_type TEXT NOT NULL DEFAULT 'never',
  ADD COLUMN IF NOT EXISTS occurrences_total INT,
  ADD COLUMN IF NOT EXISTS occurrences_done INT NOT NULL DEFAULT 1;

ALTER TABLE recurring_templates DROP CONSTRAINT IF EXISTS recurring_templates_interval_unit_check;
ALTER TABLE recurring_templates ADD CONSTRAINT recurring_templates_interval_unit_check
  CHECK (interval_unit IN ('day', 'week', 'month'));

ALTER TABLE recurring_templates DROP CONSTRAINT IF EXISTS recurring_templates_end_type_check;
ALTER TABLE recurring_templates ADD CONSTRAINT recurring_templates_end_type_check
  CHECK (end_type IN ('never', 'on_date', 'after_count'));

ALTER TABLE recurring_templates DROP CONSTRAINT IF EXISTS recurring_templates_interval_count_check;
ALTER TABLE recurring_templates ADD CONSTRAINT recurring_templates_interval_count_check
  CHECK (interval_count >= 1);

-- Backfill existing rows from the legacy pattern so already-recurring tasks
-- keep advancing on the same schedule under the new engine.
UPDATE recurring_templates SET
  interval_count = CASE pattern
    WHEN 'daily' THEN 1
    WHEN 'weekly' THEN 1
    WHEN 'biweekly' THEN 2
    WHEN 'monthly' THEN 1
    WHEN 'custom' THEN GREATEST(1, COALESCE(custom_interval_days, 7))
    ELSE 1
  END,
  interval_unit = CASE pattern
    WHEN 'daily' THEN 'day'
    WHEN 'weekly' THEN 'week'
    WHEN 'biweekly' THEN 'week'
    WHEN 'monthly' THEN 'month'
    WHEN 'custom' THEN 'day'
    ELSE 'week'
  END,
  end_type = CASE WHEN ends_on IS NOT NULL THEN 'on_date' ELSE 'never' END
WHERE interval_count = 1 AND interval_unit = 'week' AND end_type = 'never';
-- (the WHERE guards against re-stamping rows already migrated or created
-- fresh under the new engine on a re-run)
