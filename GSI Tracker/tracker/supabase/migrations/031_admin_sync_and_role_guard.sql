-- 031: Admin badge = admin rights, always; nobody can make themselves admin.
-- Idempotent. Run after 030.
--
-- Before: the Admin badge (admin_emails) and the real permission (users.role)
-- were kept in step only at sign-in or when the badge's address matched the
-- account's main email exactly. A person badged under another spelling
-- (.ai vs .com, or their second address) showed "Admin" but had member
-- rights until they signed out and in again. Removing a badge could likewise
-- leave the rights behind.
-- Also: the users update policy let anyone edit their OWN row, including
-- role, so any member could promote themselves through the API.
--
-- Now:
--  1. Guard: only admins (or the tracker's own database functions) can change
--     anyone's role, email or alternate email.
--  2. Badge → rights: adding/removing an admin_emails row updates the matching
--     account at once (main email, alternate email, or the .ai/.com twin).
--  3. Rights → badge: changing users.role (Admin page) adds/removes the badge,
--     so the next sign-in can't undo it.
--  4. One-time repair: everyone with a badge gets admin rights now.

-- ---------- 1. guard ----------
CREATE OR REPLACE FUNCTION public.guard_user_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Requests from the app/API run as anon/authenticated. The tracker's own
  -- SECURITY DEFINER functions (sign-in linking, badge sync) run as the owner
  -- and pass.
  IF current_user IN ('anon', 'authenticated')
     AND (NEW.role IS DISTINCT FROM OLD.role
          OR lower(NEW.email) IS DISTINCT FROM lower(OLD.email)
          OR lower(NEW.alt_email) IS DISTINCT FROM lower(OLD.alt_email))
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change roles or account emails' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS users_guard_privileged ON public.users;
CREATE TRIGGER users_guard_privileged BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_privileged_columns();

-- Does this account match a badge address (either spelling, either address)?
CREATE OR REPLACE FUNCTION public.user_matches_email(u public.users, e TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(e) IN (lower(u.email), lower(coalesce(u.alt_email, '')), lyzr_twin(u.email), lyzr_twin(coalesce(u.alt_email, '')));
$$;

-- ---------- 2. badge → rights ----------
CREATE OR REPLACE FUNCTION public.sync_admin_badge()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users u SET role = 'admin'
     WHERE u.role <> 'admin' AND user_matches_email(u, NEW.email);
  ELSIF TG_OP = 'DELETE' THEN
    -- Demote only if no other badge still covers this person.
    UPDATE users u SET role = 'member'
     WHERE u.role = 'admin' AND user_matches_email(u, OLD.email)
       AND NOT EXISTS (SELECT 1 FROM admin_emails a WHERE user_matches_email(u, a.email));
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS admin_emails_sync ON public.admin_emails;
CREATE TRIGGER admin_emails_sync AFTER INSERT OR DELETE ON public.admin_emails
  FOR EACH ROW EXECUTE FUNCTION public.sync_admin_badge();

-- ---------- 3. rights → badge ----------
CREATE OR REPLACE FUNCTION public.sync_admin_role()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'admin' AND OLD.role <> 'admin' THEN
    INSERT INTO admin_emails (email) SELECT lower(NEW.email)
     WHERE NOT EXISTS (SELECT 1 FROM admin_emails a WHERE user_matches_email(NEW, a.email))
    ON CONFLICT DO NOTHING;
  ELSIF NEW.role <> 'admin' AND OLD.role = 'admin' THEN
    DELETE FROM admin_emails a WHERE user_matches_email(NEW, a.email);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS users_sync_admin_role ON public.users;
CREATE TRIGGER users_sync_admin_role AFTER UPDATE OF role ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_admin_role();

-- ---------- 4. one-time repair ----------
-- Badged people get the rights; admins without a badge get one (no one
-- gains or loses rights from this second step).
UPDATE users u SET role = 'admin'
 WHERE u.role <> 'admin' AND EXISTS (SELECT 1 FROM admin_emails a WHERE user_matches_email(u, a.email));
INSERT INTO admin_emails (email)
SELECT lower(u.email) FROM users u
 WHERE u.role = 'admin' AND NOT EXISTS (SELECT 1 FROM admin_emails a WHERE user_matches_email(u, a.email))
ON CONFLICT DO NOTHING;

-- Verify: every badge and the account it reaches. rights should say admin on
-- every row; "no account yet" means that person hasn't signed in (they become
-- admin on first sign-in).
SELECT a.email AS badge, coalesce(u.email, 'no account yet') AS account, coalesce(u.role::text, '—') AS rights
  FROM admin_emails a LEFT JOIN users u ON user_matches_email(u, a.email)
 ORDER BY a.email;
