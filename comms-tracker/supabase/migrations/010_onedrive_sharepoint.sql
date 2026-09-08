-- ============================================================
-- OneDrive + SharePoint as a knowledge source, read through the same
-- per-user Microsoft connection as Outlook (delegated Files.Read.All +
-- Sites.Read.All). Mirrors Google Drive: only what the connected user can
-- themselves open, incremental via Graph's per-drive delta links.
-- ============================================================

ALTER TYPE knowledge_source_type ADD VALUE IF NOT EXISTS 'onedrive';
ALTER TYPE source_system_type ADD VALUE IF NOT EXISTS 'onedrive';

-- One delta link per drive (personal OneDrive + each SharePoint document
-- library), keyed by Graph drive id -- JSONB because the set of drives a
-- user can see changes over time.
ALTER TABLE user_oauth_tokens
  ADD COLUMN IF NOT EXISTS onedrive_delta JSONB NOT NULL DEFAULT '{}'::jsonb;
