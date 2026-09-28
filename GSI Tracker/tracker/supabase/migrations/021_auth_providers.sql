-- ============================================================
-- Migration 021: sign-in with Slack or Microsoft as well as Google.
--  * profile name / avatar read from whatever the provider sends
--    (Google: full_name + avatar_url; Slack: name + picture; Microsoft: name)
--  * only Lyzr accounts may sign in (lyzr.ai or lyzr.com); anyone else is
--    rejected at the database, whatever the provider
--  * name@lyzr.ai and name@lyzr.com are the same person: owner rows,
--    pending assignments and badges written with either spelling attach
-- Idempotent; safe to paste on the live DB.
-- ============================================================

CREATE OR REPLACE FUNCTION public.lyzr_twin(e TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN lower(e) LIKE '%@lyzr.ai'  THEN regexp_replace(lower(e), '@lyzr\.ai$',  '@lyzr.com')
    WHEN lower(e) LIKE '%@lyzr.com' THEN regexp_replace(lower(e), '@lyzr\.com$', '@lyzr.ai')
    ELSE lower(e) END;
$$;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  em   TEXT := lower(NEW.email);
  twin TEXT := lyzr_twin(NEW.email);
  md   JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  nm   TEXT;
  av   TEXT;
BEGIN
  IF em IS NULL OR NOT (em LIKE '%@lyzr.ai' OR em LIKE '%@lyzr.com') THEN
    RAISE EXCEPTION 'Only Lyzr accounts can sign in to the tracker (%)', em USING ERRCODE = '42501';
  END IF;

  nm := COALESCE(NULLIF(md->>'full_name', ''), NULLIF(md->>'name', ''), NULLIF(md->>'preferred_username', ''), split_part(em, '@', 1));
  av := COALESCE(NULLIF(md->>'avatar_url', ''), NULLIF(md->>'picture', ''));

  INSERT INTO public.users (id, email, display_name, avatar_url, role)
  VALUES (
    NEW.id, NEW.email, nm, av,
    CASE WHEN EXISTS (SELECT 1 FROM admin_emails a WHERE lower(a.email) IN (em, twin))
         THEN 'admin'::user_role ELSE 'member'::user_role END
  );

  UPDATE pending_mentions SET resolved_user_id = NEW.id, resolved_at = now() WHERE lower(email) IN (em, twin) AND resolved_user_id IS NULL;
  INSERT INTO mentions (task_id, surface, surface_ref_id, mentioned_user_id, mentioned_email, mentioned_by)
  SELECT pm.task_id, pm.surface, pm.surface_ref_id, NEW.id, NEW.email, NEW.id FROM pending_mentions pm
   WHERE lower(pm.email) IN (em, twin) AND pm.resolved_user_id = NEW.id;
  UPDATE pending_invites SET resolved_user_id = NEW.id, resolved_at = now() WHERE lower(email) IN (em, twin) AND resolved_user_id IS NULL;
  INSERT INTO task_assignments (task_id, user_id, role, assigned_by)
  SELECT pa.task_id, NEW.id,
         CASE WHEN pa.role = 'primary' AND EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = pa.task_id AND ta.role = 'primary')
              THEN 'secondary'::assignment_role ELSE pa.role END,
         pa.assigned_by
    FROM pending_assignments pa WHERE lower(pa.email) IN (em, twin) AND pa.resolved_user_id IS NULL
  ON CONFLICT (task_id, user_id) DO NOTHING;
  UPDATE pending_assignments SET resolved_user_id = NEW.id, resolved_at = now() WHERE lower(email) IN (em, twin) AND resolved_user_id IS NULL;
  UPDATE channel_owners        SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE vertical_owners       SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE vertical_members      SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE function_owners       SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE campaign_owners       SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE campaign_participants SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  RETURN NEW;
END;
$$;

-- Leadership / admin lookups by either spelling.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin');
$$;

-- Backfill: people already signed in get names/avatars refreshed from the
-- provider metadata if the profile is still the bare email prefix.
UPDATE users u SET
  display_name = COALESCE(NULLIF(a.raw_user_meta_data->>'full_name',''), NULLIF(a.raw_user_meta_data->>'name',''), u.display_name),
  avatar_url   = COALESCE(u.avatar_url, NULLIF(a.raw_user_meta_data->>'avatar_url',''), NULLIF(a.raw_user_meta_data->>'picture',''))
FROM auth.users a WHERE a.id = u.id;
