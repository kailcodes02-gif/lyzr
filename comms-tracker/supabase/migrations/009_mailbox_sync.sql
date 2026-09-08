-- ============================================================
-- Per-user mailbox reading (Gmail + Outlook) -- the "did someone already
-- email this POC from their own inbox" detection the spec calls for, plus
-- confirmation of the optimistic "sent via app" rows and the siva@lyzr.ai /
-- siva@lyzr.com internal-email knowledge store.
--
-- Both providers store one refresh token per (user, provider) in
-- user_oauth_tokens (008). Google's row now carries Drive AND Gmail scopes
-- under provider 'google' (renamed from 'google_drive'); Microsoft's row is
-- provider 'microsoft' (Mail.Read via Microsoft Graph, obtained through the
-- Worker's /api/oauth/microsoft/* routes, not through Supabase Auth -- the
-- user keeps signing in with Google, Outlook is a connected mailbox).
-- ============================================================

ALTER TYPE comm_source_system ADD VALUE IF NOT EXISTS 'gmail';
ALTER TYPE comm_source_system ADD VALUE IF NOT EXISTS 'outlook';

-- sync_runs / source_sync_state log mailbox runs under these keys.
ALTER TYPE source_system_type ADD VALUE IF NOT EXISTS 'gmail';
ALTER TYPE source_system_type ADD VALUE IF NOT EXISTS 'outlook';

ALTER TABLE user_oauth_tokens
  -- The mailbox address the token belongs to (subs@lyzr.ai for Google,
  -- subs@lyzr.com for Microsoft) -- shown in the UI and used to tell
  -- "sent by me" from "sent to me".
  ADD COLUMN IF NOT EXISTS account_email TEXT,
  -- ISO timestamp of the last successful mailbox read; the next run asks
  -- the provider for messages newer than this. NULL = first run (90-day
  -- lookback).
  ADD COLUMN IF NOT EXISTS mail_cursor TEXT,
  ADD COLUMN IF NOT EXISTS mail_synced_at TIMESTAMPTZ;

UPDATE user_oauth_tokens SET provider = 'google' WHERE provider = 'google_drive';

ALTER TABLE communication_events
  -- Which connected user's mailbox this event was read from.
  ADD COLUMN IF NOT EXISTS mailbox_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- For origin = 'sent_via_app' rows: set once a real sent message with the
  -- same recipient + subject shows up in the sender's mailbox.
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS comm_events_unconfirmed_app_idx
  ON communication_events (recipient_email, sent_at DESC)
  WHERE origin = 'sent_via_app' AND confirmed_at IS NULL;
