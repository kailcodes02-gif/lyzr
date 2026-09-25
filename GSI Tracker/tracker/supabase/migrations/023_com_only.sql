-- ============================================================
-- Migration 023: Microsoft only, lyzr.com only (per Kailash 2026-09-26).
--  * every stored lyzr.ai address becomes its lyzr.com twin (owners,
--    members, badges, pending rows, profiles, auth accounts)
--  * sign-up accepts lyzr.com only
--  * existing accounts keep their id (tasks/history stay attached) but now
--    carry the .com address, so the Microsoft login lands on them
-- Idempotent; safe to paste on the live DB. Run AFTER 022.
-- ============================================================

-- 1. Badges: keep the .com spelling only.
INSERT INTO admin_emails (email) SELECT lyzr_twin(email) FROM admin_emails WHERE email LIKE '%@lyzr.ai' ON CONFLICT DO NOTHING;
DELETE FROM admin_emails WHERE email LIKE '%@lyzr.ai';
INSERT INTO leadership_emails (email) SELECT lyzr_twin(email) FROM leadership_emails WHERE email LIKE '%@lyzr.ai' ON CONFLICT DO NOTHING;
DELETE FROM leadership_emails WHERE email LIKE '%@lyzr.ai';

-- 2. Ownership / membership rows: rewrite .ai -> .com, dropping a .ai row
--    when the .com twin already exists on the same key.
DELETE FROM channel_owners a USING channel_owners b WHERE a.email LIKE '%@lyzr.ai' AND b.channel_id = a.channel_id AND lower(b.email) = lyzr_twin(a.email);
UPDATE channel_owners SET email = lyzr_twin(email) WHERE email LIKE '%@lyzr.ai';
DELETE FROM vertical_owners a USING vertical_owners b WHERE a.email LIKE '%@lyzr.ai' AND b.vertical_id = a.vertical_id AND lower(b.email) = lyzr_twin(a.email);
UPDATE vertical_owners SET email = lyzr_twin(email) WHERE email LIKE '%@lyzr.ai';
DELETE FROM vertical_members a USING vertical_members b WHERE a.email LIKE '%@lyzr.ai' AND b.vertical_id = a.vertical_id AND lower(b.email) = lyzr_twin(a.email);
UPDATE vertical_members SET email = lyzr_twin(email) WHERE email LIKE '%@lyzr.ai';
DELETE FROM function_owners a USING function_owners b WHERE a.email LIKE '%@lyzr.ai' AND b.function_id = a.function_id AND lower(b.email) = lyzr_twin(a.email);
UPDATE function_owners SET email = lyzr_twin(email) WHERE email LIKE '%@lyzr.ai';
DELETE FROM campaign_owners a USING campaign_owners b WHERE a.email LIKE '%@lyzr.ai' AND b.campaign_id = a.campaign_id AND lower(b.email) = lyzr_twin(a.email);
UPDATE campaign_owners SET email = lyzr_twin(email) WHERE email LIKE '%@lyzr.ai';
DELETE FROM campaign_participants a USING campaign_participants b WHERE a.email LIKE '%@lyzr.ai' AND b.campaign_id = a.campaign_id AND lower(b.email) = lyzr_twin(a.email);
UPDATE campaign_participants SET email = lyzr_twin(email) WHERE email LIKE '%@lyzr.ai';
UPDATE pending_assignments SET email = lyzr_twin(email) WHERE email LIKE '%@lyzr.ai';
UPDATE pending_invites     SET email = lyzr_twin(email) WHERE email LIKE '%@lyzr.ai';
UPDATE pending_mentions    SET email = lyzr_twin(email) WHERE email LIKE '%@lyzr.ai';

-- 3. Accounts: same id, .com address. The Microsoft login then matches them.
UPDATE public.users SET alt_email = email, email = lyzr_twin(email) WHERE email LIKE '%@lyzr.ai';
UPDATE auth.users
   SET email = lyzr_twin(email),
       raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('email', lyzr_twin(email))
 WHERE email LIKE '%@lyzr.ai';

-- 4. Sign-up: lyzr.com only.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  em TEXT := lower(NEW.email); twin TEXT := lyzr_twin(NEW.email); md JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb); nm TEXT; av TEXT; existing TEXT;
BEGIN
  IF em IS NULL OR em NOT LIKE '%@lyzr.com' THEN
    RAISE EXCEPTION 'Only lyzr.com Microsoft accounts can sign in to the tracker (%)', em USING ERRCODE = '42501';
  END IF;
  SELECT email INTO existing FROM public.users WHERE lower(email) = twin OR lower(alt_email) = em LIMIT 1;
  IF existing IS NOT NULL THEN
    RAISE EXCEPTION 'You already have a tracker account as %. Ask an admin to move it to your lyzr.com address.', existing USING ERRCODE = '42501';
  END IF;
  nm := COALESCE(NULLIF(md->>'full_name', ''), NULLIF(md->>'name', ''), NULLIF(md->>'preferred_username', ''), split_part(em, '@', 1));
  av := COALESCE(NULLIF(md->>'avatar_url', ''), NULLIF(md->>'picture', ''));
  INSERT INTO public.users (id, email, display_name, avatar_url, role)
  VALUES (NEW.id, NEW.email, nm, av, CASE WHEN EXISTS (SELECT 1 FROM admin_emails a WHERE lower(a.email) IN (em, twin)) THEN 'admin'::user_role ELSE 'member'::user_role END);
  UPDATE pending_mentions SET resolved_user_id = NEW.id, resolved_at = now() WHERE lower(email) IN (em, twin) AND resolved_user_id IS NULL;
  INSERT INTO mentions (task_id, surface, surface_ref_id, mentioned_user_id, mentioned_email, mentioned_by)
  SELECT pm.task_id, pm.surface, pm.surface_ref_id, NEW.id, NEW.email, NEW.id FROM pending_mentions pm WHERE lower(pm.email) IN (em, twin) AND pm.resolved_user_id = NEW.id;
  UPDATE pending_invites SET resolved_user_id = NEW.id, resolved_at = now() WHERE lower(email) IN (em, twin) AND resolved_user_id IS NULL;
  INSERT INTO task_assignments (task_id, user_id, role, assigned_by)
  SELECT pa.task_id, NEW.id, CASE WHEN pa.role = 'primary' AND EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = pa.task_id AND ta.role = 'primary') THEN 'secondary'::assignment_role ELSE pa.role END, pa.assigned_by
    FROM pending_assignments pa WHERE lower(pa.email) IN (em, twin) AND pa.resolved_user_id IS NULL ON CONFLICT (task_id, user_id) DO NOTHING;
  UPDATE pending_assignments SET resolved_user_id = NEW.id, resolved_at = now() WHERE lower(email) IN (em, twin) AND resolved_user_id IS NULL;
  UPDATE channel_owners SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE vertical_owners SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE vertical_members SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE function_owners SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE campaign_owners SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  UPDATE campaign_participants SET user_id = NEW.id WHERE lower(email) IN (em, twin) AND user_id IS NULL;
  RETURN NEW;
END; $$;

-- 5. What to check afterwards (returns one row).
SELECT
  (SELECT count(*) FROM auth.users WHERE email LIKE '%@lyzr.ai')            AS auth_ai_left,
  (SELECT string_agg(email, ', ') FROM auth.users)                            AS auth_emails,
  (SELECT string_agg(email || ' [' || role || ']', ', ') FROM public.users)   AS profiles,
  (SELECT string_agg(email, ', ') FROM admin_emails)                          AS admins,
  (SELECT count(*) FROM vertical_owners WHERE email LIKE '%@lyzr.ai')         AS owner_rows_ai_left;
