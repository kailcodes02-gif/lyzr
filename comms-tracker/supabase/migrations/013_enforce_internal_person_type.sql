-- ============================================================
-- Belt-and-braces on top of the application-level fix (lib/sync/util.ts
-- isInternalEmail, used by lib/sync/people.ts and lib/sync/hubspot-sync.ts):
-- a Lyzr address must never be stored as person_type = 'client_poc',
-- regardless of which code path or future sync writes the row. This is the
-- fix for the mislabeling risk found 2026-09-09: a HubSpot "contact" that is
-- actually a Lyzr teammate (CC'd on a deal, an internal test contact, etc.)
-- could be inserted as client_poc if HubSpot's sync ran before Cortex ever
-- recorded that person. A live check on 2026-09-09 found zero already-
-- mislabeled rows, so this is prevention, not a backfill.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_internal_person_type()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email IS NOT NULL AND split_part(NEW.email, '@', 2) IN ('lyzr.ai', 'lyzr.com') THEN
    NEW.person_type := 'lyzr_internal';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS people_enforce_internal_type ON people;
CREATE TRIGGER people_enforce_internal_type
  BEFORE INSERT OR UPDATE OF email, person_type ON people
  FOR EACH ROW EXECUTE FUNCTION enforce_internal_person_type();
