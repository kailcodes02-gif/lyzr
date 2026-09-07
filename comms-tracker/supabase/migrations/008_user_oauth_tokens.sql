-- ============================================================
-- Per-user OAuth refresh tokens for Drive's "per-user consent" knowledge
-- source (each signed-in user grants Drive read access at their own
-- sign-in; the tracker only ever sees what that person's account can see --
-- not literally "everyone's Drive", the simpler option the user picked over
-- domain-wide delegation). Same shape will hold Microsoft Graph mail tokens
-- later (SETUP_INTEGRATIONS.md's Outlook mailbox-read feature) -- `provider`
-- is a plain TEXT column, not an enum, so adding that doesn't need a migration.
-- ============================================================

-- A refresh token is a standing credential, not session data -- it must
-- never round-trip through the browser again after the moment of consent.
-- Only the Worker's service-role client (bypasses RLS) ever writes here or
-- reads refresh_token back out; the one authenticated policy below lets a
-- user see THEIR OWN connection status (for a "Drive: connected" UI state)
-- and the app is careful to only ever select non-secret columns through it.
CREATE TABLE user_oauth_tokens (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  granted_scopes TEXT[] NOT NULL DEFAULT '{}',
  -- Drive's own incremental-sync cursor (changes.list's startPageToken) --
  -- provider-specific state that doesn't belong in source_sync_state, which
  -- is keyed per SOURCE, not per (user, source).
  drive_start_page_token TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

ALTER TABLE user_oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_own" ON user_oauth_tokens FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER user_oauth_tokens_updated_at
  BEFORE UPDATE ON user_oauth_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at();
