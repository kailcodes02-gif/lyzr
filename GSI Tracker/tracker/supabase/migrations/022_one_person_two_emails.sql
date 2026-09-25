-- ============================================================
-- Migration 022: one person, two emails (name@lyzr.ai + name@lyzr.com).
-- A person has ONE tracker account. Extra sign-in methods are attached to it
-- with Supabase "manual linking" (Me › Linked accounts), never as a second
-- user. If someone tries to sign up with a provider whose email is the twin
-- of an existing account, sign-up is refused with a message telling them to
-- link instead. `link_my_emails()` re-attaches owner / member / badge rows
-- written under either spelling and records the second email on the profile.
-- Idempotent; safe to paste on the live DB. Run AFTER 021.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS alt_email TEXT;

-- Refuse a duplicate account for the twin address.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  em   TEXT := lower(NEW.email);
  twin TEXT := lyzr_twin(NEW.email);
  md   JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  nm   TEXT;
  av   TEXT;
  existing TEXT;
BEGIN
  IF em IS NULL OR NOT (em LIKE '%@lyzr.ai' OR em LIKE '%@lyzr.com') THEN
    RAISE EXCEPTION 'Only Lyzr accounts can sign in to the tracker (%)', em USING ERRCODE = '42501';
  END IF;
  SELECT email INTO existing FROM public.users WHERE lower(email) = twin OR lower(alt_email) = em LIMIT 1;
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'You already have a tracker account as %. Sign in with that one, then add this login under Me › Linked accounts.', existing USING ERRCODE = '42501';
  END IF;

  nm := COALESCE(NULLIF(md->>'full_name', ''), NULLIF(md->>'name', ''), NULLIF(md->>'preferred_username', ''), split_part(em, '@', 1));
  av := COALESCE(NULLIF(md->>'avatar_url', ''), NULLIF(md->>'picture', ''));
  INSERT INTO public.users (id, email, display_name, avatar_url, role)
  VALUES (NEW.id, NEW.email, nm, av,
    CASE WHEN EXISTS (SELECT 1 FROM admin_emails a WHERE lower(a.email) IN (em, twin)) THEN 'admin'::user_role ELSE 'member'::user_role END);
  UPDATE pending_mentions SET resolved_user_id = NEW.id, resolved_at = now() WHERE lower(email) IN (em, twin) AND resolved_user_id IS NULL;
  INSERT INTO mentions (task_id, surface, surface_ref_id, mentioned_user_id, mentioned_email, mentioned_by)
  SELECT pm.task_id, pm.surface, pm.surface_ref_id, NEW.id, NEW.email, NEW.id FROM pending_mentions pm WHERE lower(pm.email) IN (em, twin) AND pm.resolved_user_id = NEW.id;
  UPDATE pending_invites SET resolved_user_id = NEW.id, resolved_at = now() WHERE lower(email) IN (em, twin) AND resolved_user_id IS NULL;
  INSERT INTO task_assignments (task_id, user_id, role, assigned_by)
  SELECT pa.task_id, NEW.id,
         CASE WHEN pa.role = 'primary' AND EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = pa.task_id AND ta.role = 'primary') THEN 'secondary'::assignment_role ELSE pa.role END,
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

-- Called by the app after every sign-in and after linking a provider:
-- gathers every email on the auth account (all linked identities), stores
-- the second spelling on the profile, and attaches rows written under any
-- of them. Also resolves pending assignments left for the other spelling.
CREATE OR REPLACE FUNCTION public.link_my_emails()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me UUID := auth.uid();
  emails TEXT[];
  main TEXT;
  n INT := 0; c INT;
BEGIN
  IF me IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT lower(email) INTO main FROM public.users WHERE id = me;
  SELECT array_agg(DISTINCT e) INTO emails FROM (
    SELECT lower(i.identity_data->>'email') AS e FROM auth.identities i WHERE i.user_id = me AND i.identity_data->>'email' IS NOT NULL
    UNION SELECT main
    UNION SELECT lyzr_twin(main)
  ) x WHERE e IS NOT NULL;

  UPDATE public.users SET alt_email = (SELECT e FROM unnest(emails) e WHERE e <> main AND (e LIKE '%@lyzr.ai' OR e LIKE '%@lyzr.com') LIMIT 1) WHERE id = me;

  UPDATE channel_owners        SET user_id = me WHERE lower(email) = ANY(emails) AND user_id IS NULL; GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  UPDATE vertical_owners       SET user_id = me WHERE lower(email) = ANY(emails) AND user_id IS NULL; GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  UPDATE vertical_members      SET user_id = me WHERE lower(email) = ANY(emails) AND user_id IS NULL; GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  UPDATE function_owners       SET user_id = me WHERE lower(email) = ANY(emails) AND user_id IS NULL; GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  UPDATE campaign_owners       SET user_id = me WHERE lower(email) = ANY(emails) AND user_id IS NULL; GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  UPDATE campaign_participants SET user_id = me WHERE lower(email) = ANY(emails) AND user_id IS NULL; GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  INSERT INTO task_assignments (task_id, user_id, role, assigned_by)
  SELECT pa.task_id, me,
         CASE WHEN pa.role = 'primary' AND EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = pa.task_id AND ta.role = 'primary') THEN 'secondary'::assignment_role ELSE pa.role END,
         pa.assigned_by
    FROM pending_assignments pa WHERE lower(pa.email) = ANY(emails) AND pa.resolved_user_id IS NULL
  ON CONFLICT (task_id, user_id) DO NOTHING;
  UPDATE pending_assignments SET resolved_user_id = me, resolved_at = now() WHERE lower(email) = ANY(emails) AND resolved_user_id IS NULL; GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  UPDATE public.users SET role = 'admin' WHERE id = me AND role <> 'admin' AND EXISTS (SELECT 1 FROM admin_emails a WHERE lower(a.email) = ANY(emails));
  RETURN jsonb_build_object('emails', to_jsonb(emails), 'linked_rows', n);
END;
$$;
GRANT EXECUTE ON FUNCTION public.link_my_emails() TO authenticated;

-- Badge lookups accept either spelling of the person's addresses.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin');
$$;
