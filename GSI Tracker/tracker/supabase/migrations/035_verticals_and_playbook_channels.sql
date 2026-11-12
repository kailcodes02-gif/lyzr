-- 035: The vertical list, HubSpot mapping for verticals, and the channels from
-- the Opencontroller GTM playbook. Idempotent. Run after 034.
--
--  * Verticals: Lyzr (default, not vertical-specific), GSI, Emerging Partner,
--    Hyperscalers, FDE Collective. Nothing is renamed or removed; a vertical
--    is only added when no vertical with that name or slug exists.
--  * verticals.hubspot_tracks: the HubSpot contact "Product track" values that
--    belong to the vertical (Emerging Partner, AI-FDE). The Sales pipeline
--    pulls leads by these. GSI keeps its own built-in pull rule.
--  * Channels: the playbook's channels (sections 10 to 30) are added to the
--    Lyzr board, which every vertical and product view shares. A channel that
--    already exists on Lyzr under the same slug (singular or plural) is kept
--    and not duplicated. Nothing existing is renamed, moved or deleted.

-- ---------- 1. verticals ----------
ALTER TABLE public.verticals ADD COLUMN IF NOT EXISTS hubspot_tracks TEXT[] NOT NULL DEFAULT '{}';

INSERT INTO public.verticals (name, slug, description, sort_order)
SELECT x.name, x.slug, x.description, x.sort_order
FROM (VALUES
  ('Lyzr',             'lyzr',             'Not vertical-specific: work for Lyzr as a whole', -10),
  ('GSI',              'gsi',              'Global system integrators', 10),
  ('Emerging Partner', 'emerging-partner', 'Boutiques, vCISOs, distributors and resellers', 20),
  ('Hyperscalers',     'hyperscalers',     'AWS, Microsoft and Google: marketplace and co-sell', 30),
  ('FDE Collective',   'fde-collective',   'Forward-deployed engineers', 40)
) AS x(name, slug, description, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.verticals v
  WHERE v.slug IN (x.slug, x.slug || 's', rtrim(x.slug, 's'))
     OR lower(v.name) IN (lower(x.name), lower(x.name) || 's', lower(rtrim(x.name, 's')))
);

-- Order: Lyzr, GSI, then the rest as listed.
UPDATE public.verticals SET sort_order = CASE
    WHEN slug = 'lyzr' THEN -10
    WHEN slug = 'gsi' THEN 10
    WHEN slug IN ('emerging-partner', 'emerging-partners') THEN 20
    WHEN slug = 'hyperscalers' THEN 30
    WHEN slug = 'fde-collective' THEN 40
    ELSE sort_order END
 WHERE slug IN ('lyzr', 'gsi', 'emerging-partner', 'emerging-partners', 'hyperscalers', 'fde-collective');

UPDATE public.verticals SET hubspot_tracks = '{"Emerging Partner"}'
 WHERE slug IN ('emerging-partner', 'emerging-partners') AND hubspot_tracks = '{}';
UPDATE public.verticals SET hubspot_tracks = '{"AI-FDE"}'
 WHERE slug = 'fde-collective' AND hubspot_tracks = '{}';

-- ---------- 2. playbook channels on the Lyzr board ----------
CREATE TEMP TABLE IF NOT EXISTS _playbook_channels (name TEXT, parent TEXT, result TEXT, ord SERIAL);
TRUNCATE _playbook_channels;

-- Find-or-create one channel on the Lyzr board; returns its id.
CREATE OR REPLACE FUNCTION pg_temp.playbook_channel(
  p_cat_slug TEXT, p_cat_name TEXT, p_cat_icon TEXT, p_cat_sort INT,
  p_parent UUID, p_name TEXT, p_sort INT, p_goal TEXT
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  lyzr UUID := (SELECT id FROM verticals WHERE slug = 'lyzr' LIMIT 1);
  s TEXT := public.slugify(p_name);
  cat UUID;
  ch UUID;
  parent_name TEXT := (SELECT name FROM channels WHERE id = p_parent);
BEGIN
  IF lyzr IS NULL THEN RAISE EXCEPTION 'The Lyzr vertical is missing; run 026/027 first'; END IF;

  -- Already on the Lyzr board? (same slug, or its singular / plural)
  SELECT c.id INTO ch FROM channels c
   WHERE c.vertical_id = lyzr
     AND c.parent_channel_id IS NOT DISTINCT FROM p_parent
     AND c.slug IN (s, s || 's', rtrim(s, 's'))
   ORDER BY (c.slug = s) DESC, c.is_active DESC
   LIMIT 1;
  IF ch IS NOT NULL THEN
    INSERT INTO _playbook_channels (name, parent, result) VALUES (p_name, parent_name, 'already there');
    RETURN ch;
  END IF;

  IF p_parent IS NOT NULL THEN
    SELECT category_id INTO cat FROM channels WHERE id = p_parent;
  ELSE
    SELECT id INTO cat FROM categories WHERE vertical_id = lyzr AND slug = p_cat_slug LIMIT 1;
    IF cat IS NULL THEN
      INSERT INTO categories (vertical_id, name, slug, icon, sort_order)
      VALUES (lyzr, p_cat_name, p_cat_slug, p_cat_icon, p_cat_sort) RETURNING id INTO cat;
    END IF;
  END IF;

  INSERT INTO channels (category_id, vertical_id, parent_channel_id, name, slug, sort_order, goal, extra)
  VALUES (cat, lyzr, p_parent, p_name, s, p_sort, p_goal, jsonb_build_object('source', 'Opencontroller GTM playbook'))
  RETURNING id INTO ch;
  INSERT INTO _playbook_channels (name, parent, result) VALUES (p_name, parent_name, 'added');
  RETURN ch;
END;
$$;

DO $$
DECLARE
  p UUID;
BEGIN
  -- Always in the news (§10, §11)
  PERFORM pg_temp.playbook_channel('always-in-the-news', 'Always in the news', 'zap', 10, NULL, 'Monthly thunderclaps', 1,
    'One campaign and one two-week thunderclap every month: PR, founder post, employee reshares, ads at 2x, webinar on day 7, recap on day 14');
  PERFORM pg_temp.playbook_channel('always-in-the-news', 'Always in the news', 'zap', 10, NULL, 'PR and press releases', 2,
    'A PR headline every two weeks; customer launches (PepsiCo, March 2027)');

  -- LinkedIn (§12)
  PERFORM pg_temp.playbook_channel('linkedin', 'LinkedIn', 'share-2', 20, NULL, 'Lyzr company page', 1,
    'The company story: customer stories, PR, partner news, hiring. 3 posts a week');
  PERFORM pg_temp.playbook_channel('linkedin', 'LinkedIn', 'share-2', 20, NULL, 'Product showcase pages', 2,
    'Each product''s own voice (e.g. Opencontroller): number of the week, product GIFs, comparisons. 5 posts a week');
  p := pg_temp.playbook_channel('linkedin', 'LinkedIn', 'share-2', 20, NULL, 'Founder and leader voices', 3,
    'Point of view from Siva, Akshay and Ani; thought-leader ads run on these posts');
  PERFORM pg_temp.playbook_channel('linkedin', 'LinkedIn', 'share-2', 20, p, 'Siva (CEO)', 1, 'Vision and contrarian views. 4 posts a week');
  PERFORM pg_temp.playbook_channel('linkedin', 'LinkedIn', 'share-2', 20, p, 'Akshay (Head of Revenue)', 2, 'What buyers are doing. 3 posts a week');
  PERFORM pg_temp.playbook_channel('linkedin', 'LinkedIn', 'share-2', 20, p, 'Ani (CGO)', 3, 'Field notes and partner voice. 3 posts a week');
  PERFORM pg_temp.playbook_channel('linkedin', 'LinkedIn', 'share-2', 20, NULL, 'Product managers', 4,
    'Product truth: screenshot stories, build logs, integration launches. 2 posts a week each');
  PERFORM pg_temp.playbook_channel('linkedin', 'LinkedIn', 'share-2', 20, NULL, 'Employee advocacy', 5,
    'SDRs, AEs and FDEs: field notes, event clips, reshares within 60 minutes. 1 post a week each');
  PERFORM pg_temp.playbook_channel('linkedin', 'LinkedIn', 'share-2', 20, NULL, 'LinkedIn newsletters', 6,
    'Run our own (fortnightly / monthly) and get featured in 20 others');
  PERFORM pg_temp.playbook_channel('linkedin', 'LinkedIn', 'share-2', 20, NULL, 'Commenting playbook', 7,
    '10 comments a day each on a 200-person target list. One fact or one question; never pitch');
  PERFORM pg_temp.playbook_channel('linkedin', 'LinkedIn', 'share-2', 20, NULL, 'LinkedIn outreach (1st and 2nd degree)', 8,
    'Founder messages to 1st-degree contacts; connection note then day-3 follow-up for 2nd degree');

  -- Paid media (§13, §14, §16)
  PERFORM pg_temp.playbook_channel('paid-media', 'Paid media', 'zap', 30, NULL, 'LinkedIn ads', 1,
    'Ad creatives and thought-leader ads; four at a time, rotate every three weeks; kill any ad set with no MQL after $3K');
  PERFORM pg_temp.playbook_channel('paid-media', 'Paid media', 'zap', 30, NULL, 'YouTube and 60-second films', 2,
    'One search query per video; shorts that work without sound');
  PERFORM pg_temp.playbook_channel('paid-media', 'Paid media', 'zap', 30, NULL, 'Paid search', 3,
    'Bottom-of-funnel only: competitor alternatives and tool searches');

  -- Content (§15, §17, §18, §20, §21)
  PERFORM pg_temp.playbook_channel('content', 'Content', 'file-text', 40, NULL, 'SEO and AEO', 1,
    'Pillar pages, article clusters and comparison pages built around the buyer agenda');
  PERFORM pg_temp.playbook_channel('content', 'Content', 'file-text', 40, NULL, 'White papers and research', 2,
    'Flagship reports (State of the AI Estate) and lead magnets, refreshed quarterly');
  PERFORM pg_temp.playbook_channel('content', 'Content', 'file-text', 40, NULL, 'Forbes and trade press', 3,
    'A founder byline a month, then trade press by buyer');
  PERFORM pg_temp.playbook_channel('content', 'Content', 'file-text', 40, NULL, 'Email nurture', 4,
    'Nurture tracks and a fortnightly newsletter: one number, one link, one CTA');
  PERFORM pg_temp.playbook_channel('content', 'Content', 'file-text', 40, NULL, 'Newsletter sponsorships', 5,
    'Sponsor two a month by theme; pitch data to the rest for free');
  PERFORM pg_temp.playbook_channel('content', 'Content', 'file-text', 40, NULL, 'Podcasts', 6,
    'Founders and product lead as guests, plus our own show');

  -- Events and community (§19, §27, §28)
  PERFORM pg_temp.playbook_channel('events', 'Events', 'calendar', 50, NULL, 'Masterclasses', 1,
    '60-minute, certificate-backed sessions co-hosted with a partner');
  PERFORM pg_temp.playbook_channel('events', 'Events', 'calendar', 50, NULL, 'Webinars', 2,
    'Launch webinars on day 7 of each thunderclap');
  p := pg_temp.playbook_channel('events', 'Events', 'calendar', 50, NULL, 'Events by city', 3,
    'Big shows for meetings, small owned rooms for pipeline');
  PERFORM pg_temp.playbook_channel('events', 'Events', 'calendar', 50, p, 'Owned nights', 1, '30-person evenings on Luma with a live demo; monthly');
  PERFORM pg_temp.playbook_channel('events', 'Events', 'calendar', 50, p, 'Executive dinners', 2, '12-seat CISO / CIO dinners; quarterly');
  PERFORM pg_temp.playbook_channel('events', 'Events', 'calendar', 50, p, 'Trade shows', 3, 'RSAC, Black Hat, GISEC and similar');
  PERFORM pg_temp.playbook_channel('events', 'Events', 'calendar', 50, NULL, 'Hackathons', 4,
    'Virtual first, one live edition a year; create research, community and pipeline');

  -- Influence (§22, §23)
  PERFORM pg_temp.playbook_channel('influence', 'Influence', 'users', 60, NULL, 'Analysts', 1,
    'Quarterly briefings with data analysts don''t have; get named where buyers shortlist');
  PERFORM pg_temp.playbook_channel('influence', 'Influence', 'users', 60, NULL, 'Investor and peer networks', 2,
    'Ask every investor and community for ten warm intros; investor-hosted dinners');

  -- Partners (§24, §25, §26)
  PERFORM pg_temp.playbook_channel('partners', 'Partners', 'handshake', 70, NULL, 'GSIs', 1,
    'Accenture, KPMG, PwC, Deloitte, EY, BCG: co-branded assessment that converts into resale');
  p := pg_temp.playbook_channel('partners', 'Partners', 'handshake', 70, NULL, 'Hyperscalers', 2,
    'Marketplace private offers and co-sell');
  PERFORM pg_temp.playbook_channel('partners', 'Partners', 'handshake', 70, p, 'AWS', 1, 'Marketplace private offer; co-sell registration on every deal');
  PERFORM pg_temp.playbook_channel('partners', 'Partners', 'handshake', 70, p, 'Microsoft', 2, 'Azure Marketplace and co-sell');
  PERFORM pg_temp.playbook_channel('partners', 'Partners', 'handshake', 70, p, 'Google Cloud', 3, 'Google Cloud Marketplace and co-sell');
  PERFORM pg_temp.playbook_channel('partners', 'Partners', 'handshake', 70, NULL, 'ISV and hardware OEMs', 3,
    'Platform partners: governance unblocks production, production drives their revenue');
  PERFORM pg_temp.playbook_channel('partners', 'Partners', 'handshake', 70, NULL, 'Resellers, distributors and credit unions', 4,
    'TD SYNNEX first, security VARs, and the organisations credit unions buy through');

  -- Sales enablement (§29, §30)
  PERFORM pg_temp.playbook_channel('sales-enablement', 'Sales enablement', 'send', 80, NULL, 'SDR enablement', 1,
    'Video library, live intent signals and one offer for the SDR team');
  p := pg_temp.playbook_channel('sales-enablement', 'Sales enablement', 'send', 80, NULL, 'ABM', 2,
    'Named-account programmes in three tiers');
  PERFORM pg_temp.playbook_channel('sales-enablement', 'Sales enablement', 'send', 80, p, 'Tier 1 accounts', 1, '100 accounts: custom hypothesis, direct mail, founder note, dinner invite');
  PERFORM pg_temp.playbook_channel('sales-enablement', 'Sales enablement', 'send', 80, p, 'Tier 2 accounts', 2, '400 accounts: vertical pages, ads, webinars');
  PERFORM pg_temp.playbook_channel('sales-enablement', 'Sales enablement', 'send', 80, p, 'Tier 3 accounts', 3, '1,500 accounts: programmatic LinkedIn, Google, retargeting');
  PERFORM pg_temp.playbook_channel('sales-enablement', 'Sales enablement', 'send', 80, NULL, 'Sales collateral', 3,
    'Sample report, security note, battlecards, pricing and ROI, demo script, partner kit');
END $$;

-- Verify 1: the verticals, in order, with their HubSpot mapping.
SELECT name, slug, sort_order, hubspot_tracks FROM public.verticals WHERE is_active ORDER BY sort_order, name;

-- Verify 2: every playbook channel and whether it was added or already there
-- (32 top-level channels + 12 sub-channels; a re-run shows all "already there").
SELECT COALESCE(parent || ' › ', '') || name AS channel, result FROM _playbook_channels ORDER BY ord;
