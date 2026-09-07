-- ============================================================
-- Phase 2 dashboard support — run after 001_initial_schema.sql
-- ============================================================

-- Per-account last-contact / total-email rollup, used by the main tracker
-- list view. Kept as a separate simple view from account_month_coverage
-- (which is month-bucketed) since the list just needs one number per account.
CREATE VIEW account_last_contact AS
SELECT
  account_id,
  max(sent_at) AS last_contact_at,
  count(*) AS total_emails
FROM communication_events
WHERE match_status = 'matched' AND account_id IS NOT NULL
GROUP BY account_id;
