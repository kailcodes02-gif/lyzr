-- ============================================================
-- Adds a distinct role for HubSpot deal owners (the sales rep assigned to
-- an account's deal), separate from Cortex's 'internal_owner' (the
-- product/project manager) — so an account can show both a "Product
-- Owner" and a "Deal Owner" without conflating the two.
-- Run after 001_initial_schema.sql and 002_dashboard_views.sql.
-- ============================================================

ALTER TYPE relationship_role ADD VALUE IF NOT EXISTS 'deal_owner';
