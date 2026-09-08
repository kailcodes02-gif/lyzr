-- ============================================================
-- Full plain-text email body on communication_events, so double-clicking
-- an email in the tracker shows the whole message, not the 400-char
-- snippet. Populated by the next sync of each source (HubSpot re-fetches
-- every engagement, so existing rows fill in on the next refresh); Gmail /
-- Outlook reads store it for the messages they keep. Bounded to ~20k chars
-- per row in code.
-- ============================================================

ALTER TABLE communication_events ADD COLUMN IF NOT EXISTS body_text TEXT;
