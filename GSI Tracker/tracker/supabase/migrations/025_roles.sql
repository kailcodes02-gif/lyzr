-- ============================================================
-- Migration 025: roles list (per Kailash, 2026-09-28)
-- Admins: Ani, Kailash, Devanarayanan, Mothilal (all @lyzr.com; @lyzr.ai
-- twins kept for the linked-account spelling). GSI vertical owner: Kailash.
-- Idempotent; safe to paste on the live DB. Also added to 018's seed so a
-- future reset keeps the same admins.
-- ============================================================

-- Devanarayanan joins the admin list (the other three are already in 018).
INSERT INTO admin_emails (email) VALUES
  ('devanarayanan.iyer@lyzr.ai'), ('devanarayanan.iyer@lyzr.com')
ON CONFLICT (email) DO NOTHING;

-- Admins are leadership by default (mirrors the 019 seed for the new row).
INSERT INTO leadership_emails (email)
SELECT email FROM admin_emails
ON CONFLICT DO NOTHING;

-- Promote anyone already signed in, matching either spelling on the account.
UPDATE users u SET role = 'admin'::user_role
 WHERE u.role <> 'admin'
   AND EXISTS (
     SELECT 1 FROM admin_emails a
      WHERE lower(a.email) = lower(u.email)
         OR lower(a.email) = lower(coalesce(u.alt_email, ''))
   );

-- GSI vertical owner: Kailash, primary (convention: sort_order <= 0 = primary).
INSERT INTO vertical_owners (vertical_id, email, user_id, sort_order)
SELECT v.id,
       'kailash.gm@lyzr.com',
       (SELECT id FROM users
         WHERE lower(email) = 'kailash.gm@lyzr.com'
            OR lower(coalesce(alt_email, '')) = 'kailash.gm@lyzr.com'
         LIMIT 1),
       0
  FROM verticals v
 WHERE v.slug = 'gsi'
ON CONFLICT (vertical_id, email)
DO UPDATE SET sort_order = LEAST(vertical_owners.sort_order, 0);

-- Verify: expect 8 admin emails, kailash.gm@lyzr.com owning gsi, and every
-- signed-in admin promoted.
SELECT 'admin_emails' AS what, count(*)::text AS value FROM admin_emails
UNION ALL
SELECT 'gsi owners', string_agg(o.email, ', ' ORDER BY o.sort_order)
  FROM vertical_owners o JOIN verticals v ON v.id = o.vertical_id
 WHERE v.slug = 'gsi'
UNION ALL
SELECT 'admin users', string_agg(email, ', ')
  FROM users WHERE role = 'admin';
