-- ============================================================
-- Grants admin on sign-in (and immediately, for anyone already signed in
-- at least once) to three more addresses, as requested 2026-09-09:
--   kailash.gm@lyzr.com, deepankar.dimri@lyzr.com, shekar@lyzr.com
--
-- IMPORTANT: sign-in is Google OAuth restricted to the lyzr.ai account
-- chooser (login page passes hd=lyzr.ai) -- a *hint* to Google's UI, not a
-- server-enforced domain lock, and it has no effect on lyzr.com addresses
-- either way. Two of these three people (kailash.gm, shekar) already sign
-- in and are admins under their @lyzr.ai address; @lyzr.com is their
-- Outlook mailbox identity (mail connection), not how they sign into this
-- app. This migration adds the literal @lyzr.com addresses as requested;
-- if lyzr.com isn't itself a Google-sign-in-capable Workspace domain, a
-- row for that exact address will simply never be created and this has no
-- effect for that person until they sign in with an address that matches.
-- The existing @lyzr.ai rows for kailash.gm and shekar are untouched and
-- remain admin regardless.
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    CASE
      WHEN NEW.email IN (
        'subs@lyzr.ai', 'kailash.gm@lyzr.ai', 'shekar@lyzr.ai',
        'kailash.gm@lyzr.com', 'deepankar.dimri@lyzr.com', 'shekar@lyzr.com'
      ) THEN 'admin'::user_role
      ELSE 'member'::user_role
    END
  );
  RETURN NEW;
END;
$$;

UPDATE public.users
SET role = 'admin'
WHERE email IN (
  'subs@lyzr.ai', 'kailash.gm@lyzr.ai', 'shekar@lyzr.ai',
  'kailash.gm@lyzr.com', 'deepankar.dimri@lyzr.com', 'shekar@lyzr.com'
) AND role != 'admin';
