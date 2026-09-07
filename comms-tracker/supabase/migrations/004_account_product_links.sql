-- ============================================================
-- Product/app links per account, from Cortex's per-project `appLink` field
-- (shown on the account detail page alongside product_engaged).
-- Run after 001-003.
-- ============================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS product_links JSONB NOT NULL DEFAULT '[]'::jsonb;
