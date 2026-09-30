-- 030: Safety rails for the REST API (/api/v1). Needs 029. Idempotent.
--
--  * Keys can expire (expires_at; NULL = never).
--  * Deleting tasks needs its own permission (can_delete, write keys only).
--  * Rate limit: 60 requests a minute per key; more are refused with 429.
--  * Activity log: every accepted request (key, method, path, status, time),
--    readable by admins, kept 90 days.

ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS can_delete BOOLEAN NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_delete_needs_write') THEN
    ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_delete_needs_write CHECK (NOT can_delete OR scope = 'write');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.api_request_log (
  id      BIGSERIAL PRIMARY KEY,
  key_id  UUID NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  method  TEXT NOT NULL,
  path    TEXT NOT NULL,
  status  INT
);
CREATE INDEX IF NOT EXISTS api_request_log_key_at_idx ON public.api_request_log(key_id, at DESC);
ALTER TABLE public.api_request_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "api_request_log_admin_read" ON public.api_request_log;
-- Admins read; only the functions below write (no insert/update policies).
CREATE POLICY "api_request_log_admin_read" ON public.api_request_log FOR SELECT TO authenticated USING (is_admin());
GRANT SELECT ON public.api_request_log TO authenticated;

-- Resolve a presented key, enforce expiry and the rate limit, and log the
-- request. Returns no row for an unknown / revoked / expired key or one whose
-- owner is no longer an admin.
DROP FUNCTION IF EXISTS public.api_resolve_key(TEXT);
DROP FUNCTION IF EXISTS public.api_resolve_key(TEXT, TEXT, TEXT);
CREATE FUNCTION public.api_resolve_key(p_hash TEXT, p_method TEXT, p_path TEXT)
RETURNS TABLE (log_id BIGINT, user_id UUID, email TEXT, scope TEXT, can_delete BOOLEAN, expires_at TIMESTAMPTZ, retry_after INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k      RECORD;
  n      INT;
  oldest TIMESTAMPTZ;
  lid    BIGINT;
BEGIN
  SELECT ak.id, ak.user_id AS uid, ak.scope AS sc, ak.can_delete AS del, ak.expires_at AS exp, u.email AS em INTO k
  FROM api_keys ak JOIN users u ON u.id = ak.user_id
  WHERE ak.key_hash = p_hash AND ak.revoked_at IS NULL
    AND (ak.expires_at IS NULL OR ak.expires_at > now())
    AND u.role = 'admin';
  IF NOT FOUND THEN RETURN; END IF;

  -- One key's concurrent requests queue here so the count is exact.
  PERFORM pg_advisory_xact_lock(hashtext('api_key:' || k.id::text));
  SELECT count(*), min(l.at) INTO n, oldest
  FROM api_request_log l WHERE l.key_id = k.id AND l.at > now() - interval '1 minute';
  UPDATE api_keys SET last_used_at = now() WHERE id = k.id;

  IF n >= 60 THEN
    RETURN QUERY SELECT NULL::BIGINT, k.uid, k.em, k.sc, k.del, k.exp,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (oldest + interval '1 minute' - now()))))::INT;
    RETURN;
  END IF;

  INSERT INTO api_request_log (key_id, method, path) VALUES (k.id, left(p_method, 10), left(p_path, 300)) RETURNING id INTO lid;
  IF random() < 0.01 THEN DELETE FROM api_request_log WHERE at < now() - interval '90 days'; END IF;
  RETURN QUERY SELECT lid, k.uid, k.em, k.sc, k.del, k.exp, 0;
END;
$$;

-- Record the response status of a logged request (only with the same key).
CREATE OR REPLACE FUNCTION public.api_log_status(p_hash TEXT, p_log_id BIGINT, p_status INT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE api_request_log l SET status = p_status
  FROM api_keys k
  WHERE l.id = p_log_id AND l.key_id = k.id AND k.key_hash = p_hash AND l.status IS NULL;
$$;

REVOKE ALL ON FUNCTION public.api_resolve_key(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.api_log_status(TEXT, BIGINT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_resolve_key(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_log_status(TEXT, BIGINT, INT) TO anon, authenticated;

-- Verify
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'api_keys' AND column_name IN ('expires_at', 'can_delete')) AS new_key_columns,  -- 2
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'api_request_log') AS log_table,                                     -- 1
  (SELECT count(*) FROM pg_proc WHERE proname IN ('api_resolve_key', 'api_log_status')) AS functions;                                               -- 2
