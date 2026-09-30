-- 029: API keys for the tracker's public REST API (/api/v1, a Cloudflare Pages
-- Function). Idempotent.
--
-- A key acts as the admin who created it: the API signs a short-lived token
-- for that user, so every request runs through the same row-level security as
-- the dashboard and every change lands in History under their name.
-- Only a SHA-256 hash of each key is stored; the key itself is shown once.

CREATE TABLE IF NOT EXISTS public.api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,                       -- first characters, to recognise a key in the list
  key_hash     TEXT NOT NULL UNIQUE,                -- hex SHA-256 of the full key
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scope        TEXT NOT NULL DEFAULT 'read' CHECK (scope IN ('read', 'write')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON public.api_keys(user_id);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "api_keys_admin_read"   ON public.api_keys;
DROP POLICY IF EXISTS "api_keys_admin_insert" ON public.api_keys;
DROP POLICY IF EXISTS "api_keys_admin_update" ON public.api_keys;
-- Admins manage keys, and only ever as themselves; nobody can delete a key's
-- record (revoke instead, so the audit trail survives).
CREATE POLICY "api_keys_admin_read"   ON public.api_keys FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "api_keys_admin_insert" ON public.api_keys FOR INSERT TO authenticated WITH CHECK (is_admin() AND user_id = auth.uid());
CREATE POLICY "api_keys_admin_update" ON public.api_keys FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
GRANT SELECT, INSERT, UPDATE ON public.api_keys TO authenticated;

-- The API resolves a presented key through this function (called with the
-- public anon key). It only answers for the hash of a real, unrevoked key,
-- and a key stops working the moment its owner is no longer an admin.
CREATE OR REPLACE FUNCTION public.api_resolve_key(p_hash TEXT)
RETURNS TABLE (user_id UUID, email TEXT, scope TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    UPDATE api_keys k SET last_used_at = now()
    FROM users u
    WHERE k.key_hash = p_hash AND k.revoked_at IS NULL
      AND u.id = k.user_id AND u.role = 'admin'
    RETURNING k.user_id, u.email, k.scope;
END;
$$;
REVOKE ALL ON FUNCTION public.api_resolve_key(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_resolve_key(TEXT) TO anon, authenticated;

-- Verify
SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'api_keys') AS api_keys_table,
  (SELECT count(*) FROM pg_proc WHERE proname = 'api_resolve_key') AS resolve_function;
