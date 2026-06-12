-- ============================================================
-- Lyzr GSI/SI Marketing Tracker - Seed channel_fields (Spec v2 §8)
-- Idempotent: ON CONFLICT (channel_id, slug) DO NOTHING
-- Resolves channel_id via slug subqueries; for nested channels uses
-- leaf slug (slugs are unique enough across the seeded taxonomy except
-- where noted explicitly with qualifiers).
-- ============================================================

-- ============================================================
-- Social > LinkedIn page (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-page'),
        'Posted by', 'posted_by', 'text', 'planning', 1,
        'Name of the executive whose page this is for (Anju, Siva, Vidur, etc.)')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-page'),
        'Post type', 'post_type', 'dropdown', 'planning',
        '["article","thought_leadership","video","text_only","reshare"]'::jsonb, 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Social > LinkedIn page (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-page'),
        'Post URL', 'post_url', 'url', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-page'),
        'Total impressions', 'total_impressions', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-page'),
        'Reactions', 'reactions', 'number', 'tracker', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-page'),
        'Comments', 'comments', 'number', 'tracker', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-page'),
        'Reshares', 'reshares', 'number', 'tracker', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-page'),
        'Engagement rate', 'engagement_rate', 'number', 'tracker', TRUE,
        '(reactions + comments + reshares) / total_impressions * 100', 6)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-page'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-page'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-page'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Social > LinkedIn article (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-article'),
        'Posted by', 'posted_by', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-article'),
        'Working title', 'working_title', 'text', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-article'),
        'Target keyword', 'target_keyword', 'text', 'planning', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-article'),
        'Word count target', 'word_count_target', 'number', 'planning', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Social > LinkedIn article (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-article'),
        'Article URL', 'article_url', 'url', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-article'),
        'Word count actual', 'word_count_actual', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-article'),
        'Total reads', 'total_reads', 'number', 'tracker', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-article'),
        'Reactions', 'reactions', 'number', 'tracker', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-article'),
        'Comments', 'comments', 'number', 'tracker', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-article'),
        'Reshares', 'reshares', 'number', 'tracker', 6)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-article'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-article'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-article'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Social > Reddit (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'reddit'),
        'Subreddit', 'subreddit', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'reddit'),
        'Post type', 'post_type', 'dropdown', 'planning',
        '["original_post","comment_thread","ama"]'::jsonb, 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Social > Reddit (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'reddit'),
        'Post URL', 'post_url', 'url', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'reddit'),
        'Upvotes', 'upvotes', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'reddit'),
        'Comments received', 'comments_received', 'number', 'tracker', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'reddit'),
        'Comments posted by us', 'comments_posted_by_us', 'number', 'tracker', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'reddit'),
        'Karma delta', 'karma_delta', 'number', 'tracker', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'reddit'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'reddit'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'reddit'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Social > LinkedIn Ads (parent, cascades to all 4 sub-types) (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, cascades_to_children, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'Ad account', 'ad_account', 'text', 'planning', TRUE, 1,
        'Which LinkedIn ad account')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'Launch date', 'launch_date', 'date', 'planning', TRUE, 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'End date', 'end_date', 'date', 'planning', TRUE, 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'Budget per ad', 'budget_per_ad', 'currency', 'planning', TRUE, 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'Budget per lead', 'budget_per_lead', 'currency', 'planning', TRUE, 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'Targeting summary', 'targeting_summary', 'long_text', 'planning', TRUE, 6)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Social > LinkedIn Ads (parent, cascades to all 4 sub-types) (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'Launch date actual', 'launch_date_actual', 'date', 'tracker', TRUE, 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'End date actual', 'end_date_actual', 'date', 'tracker', TRUE, 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'Total spend', 'total_spend', 'currency', 'tracker', TRUE, 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'Impressions', 'impressions', 'number', 'tracker', TRUE, 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'Clicks', 'clicks', 'number', 'tracker', TRUE, 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'CTR', 'ctr', 'number', 'tracker', TRUE,
        'clicks / impressions * 100', TRUE, 6)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'CPC', 'cpc', 'currency', 'tracker', TRUE,
        'total_spend / clicks', TRUE, 7)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'CPM', 'cpm', 'currency', 'tracker', TRUE,
        'total_spend / impressions * 1000', TRUE, 8)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields on parent (cascade to children)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, cascades_to_children, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'Insights', 'insights', 'long_text', 'tracker', TRUE, 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'Result URL', 'result_url', 'url', 'tracker', TRUE, 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, cascades_to_children, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'linkedin-ads' AND parent_channel_id IS NULL),
        'Result file', 'result_file', 'file', 'tracker', TRUE, 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Social > LinkedIn Ads > Conversation ads (additional tracker fields)
-- Universal Insights/result_url/result_file cascade from parent - do NOT repeat
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'conversation-ads'),
        'Conversation opens', 'conversation_opens', 'number', 'tracker', 10)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'conversation-ads'),
        'Conversation completions', 'conversation_completions', 'number', 'tracker', 11)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'conversation-ads'),
        'CTA clicks', 'cta_clicks', 'number', 'tracker', 12)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'conversation-ads'),
        'CPA', 'cpa', 'currency', 'tracker', TRUE,
        'total_spend / cta_clicks', 13)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'conversation-ads'),
        'TOFU count', 'tofu_count', 'number', 'tracker', 14,
        'Placeholder, definition TBD by user')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'conversation-ads'),
        'MOFU count', 'mofu_count', 'number', 'tracker', 15)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'conversation-ads'),
        'BOFU count', 'bofu_count', 'number', 'tracker', 16)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Social > LinkedIn Ads > Lead gen ads (additional tracker fields)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'lead-gen-ads'),
        'Leads generated', 'leads_generated', 'number', 'tracker', 10)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'lead-gen-ads'),
        'Cost per lead actual', 'cost_per_lead_actual', 'currency', 'tracker', TRUE,
        'total_spend / leads_generated', 11)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Content > Case study (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'case-study'),
        'Customer / partner name', 'customer_partner_name', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'case-study'),
        'Product featured', 'product_featured', 'multi_select', 'planning',
        '["Jazon","Skott","Diane","Jeff","Dwight","Kathy","Cognis","LyzrGPT","GitAgent","Architect"]'::jsonb, 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'case-study'),
        'Approval owner email', 'approval_owner_email', 'email', 'planning', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'case-study'),
        'Distribution channels', 'distribution_channels', 'multi_select', 'planning',
        '["website","linkedin","sales_enablement","partner_site"]'::jsonb, 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'case-study'),
        'Word count target', 'word_count_target', 'number', 'planning', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Content > Case study (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'case-study'),
        'Published URL', 'published_url', 'url', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'case-study'),
        'Publish date', 'publish_date', 'date', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'case-study'),
        'Total reads', 'total_reads', 'number', 'tracker', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'case-study'),
        'Top traffic source', 'top_traffic_source', 'text', 'tracker', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'case-study'),
        'Sales enablement reuse count', 'sales_enablement_reuse_count', 'number', 'tracker', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'case-study'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'case-study'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'case-study'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Content > Blogs (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'blogs'),
        'Working title', 'working_title', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'blogs'),
        'Target keyword', 'target_keyword', 'text', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'blogs'),
        'Word count target', 'word_count_target', 'number', 'planning', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'blogs'),
        'Distribution channels', 'distribution_channels', 'multi_select', 'planning',
        '["website","linkedin","sales_enablement","partner_site"]'::jsonb, 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'blogs'),
        'SEO meta description', 'seo_meta_description', 'long_text', 'planning', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Content > Blogs (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'blogs'),
        'Published URL', 'published_url', 'url', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'blogs'),
        'Publish date', 'publish_date', 'date', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'blogs'),
        'Total reads', 'total_reads', 'number', 'tracker', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'blogs'),
        'Top traffic source', 'top_traffic_source', 'text', 'tracker', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'blogs'),
        'Backlinks earned', 'backlinks_earned', 'number', 'tracker', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'blogs'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'blogs'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'blogs'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Content > Newsletter (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'newsletter'),
        'Issue number', 'issue_number', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'newsletter'),
        'Send date', 'send_date', 'date', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'newsletter'),
        'Audience segment', 'audience_segment', 'dropdown', 'planning',
        '["all_subscribers","icp_only","partners","investors"]'::jsonb, 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'newsletter'),
        'Subject line draft', 'subject_line_draft', 'text', 'planning', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Content > Newsletter (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'newsletter'),
        'Total sends', 'total_sends', 'number', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'newsletter'),
        'Total opens', 'total_opens', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'newsletter'),
        'Open rate', 'open_rate', 'number', 'tracker', TRUE,
        'total_opens / total_sends * 100', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'newsletter'),
        'Clicks', 'clicks', 'number', 'tracker', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'newsletter'),
        'Unsubscribes', 'unsubscribes', 'number', 'tracker', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'newsletter'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'newsletter'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'newsletter'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Content > White paper (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'white-paper'),
        'Working title', 'working_title', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'white-paper'),
        'Theme pillar', 'theme_pillar', 'text', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'white-paper'),
        'Lead author', 'lead_author', 'person', 'planning', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'white-paper'),
        'Co-authors', 'co_authors', 'multi_select', 'planning', 4,
        'Pulls from users')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'white-paper'),
        'Word count target', 'word_count_target', 'number', 'planning', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'white-paper'),
        'Is gated', 'is_gated', 'checkbox', 'planning', 6)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Content > White paper (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'white-paper'),
        'Published URL', 'published_url', 'url', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'white-paper'),
        'Total downloads', 'total_downloads', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'white-paper'),
        'Gated form submissions', 'gated_form_submissions', 'number', 'tracker', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'white-paper'),
        'Backlinks earned', 'backlinks_earned', 'number', 'tracker', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'white-paper'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'white-paper'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'white-paper'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Content > Playbooks (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'playbooks'),
        'Working title', 'working_title', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'playbooks'),
        'Audience', 'audience', 'text', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'playbooks'),
        'Distribution channels', 'distribution_channels', 'multi_select', 'planning',
        '["website","linkedin","sales_enablement","partner_site"]'::jsonb, 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'playbooks'),
        'Companion assets', 'companion_assets', 'long_text', 'planning', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Content > Playbooks (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'playbooks'),
        'Published URL', 'published_url', 'url', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'playbooks'),
        'Total downloads', 'total_downloads', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'playbooks'),
        'Sales enablement reuse count', 'sales_enablement_reuse_count', 'number', 'tracker', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'playbooks'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'playbooks'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'playbooks'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Events > Panels (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'panels'),
        'Event name', 'event_name', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'panels'),
        'Event date', 'event_date', 'date', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'panels'),
        'Venue or virtual', 'venue_or_virtual', 'text', 'planning', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'panels'),
        'Lyzr speaker', 'lyzr_speaker', 'person', 'planning', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'panels'),
        'Panel topic', 'panel_topic', 'text', 'planning', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'panels'),
        'Other panelists', 'other_panelists', 'long_text', 'planning', 6)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Events > Panels (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'panels'),
        'Total attendees', 'total_attendees', 'number', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'panels'),
        'Lyzr attributable leads', 'lyzr_attributable_leads', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'panels'),
        'Meetings booked', 'meetings_booked', 'number', 'tracker', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'panels'),
        'Pipeline influenced (USD)', 'pipeline_influenced_usd', 'currency', 'tracker', 4,
        'Manual entry per spec §13')
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'panels'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'panels'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'panels'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Events > Sponsor (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'sponsor'),
        'Event name', 'event_name', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'sponsor'),
        'Event date range', 'event_date_range', 'date_range', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'sponsor'),
        'Sponsorship tier', 'sponsorship_tier', 'dropdown', 'planning',
        '["title","platinum","gold","silver","bronze","custom"]'::jsonb, 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'sponsor'),
        'Sponsorship cost', 'sponsorship_cost', 'currency', 'planning', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'sponsor'),
        'Deliverables', 'deliverables', 'long_text', 'planning', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Events > Sponsor (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'sponsor'),
        'Total attendees', 'total_attendees', 'number', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'sponsor'),
        'Lyzr attributable leads', 'lyzr_attributable_leads', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'sponsor'),
        'Cost per lead', 'cost_per_lead', 'currency', 'tracker', TRUE,
        'sponsorship_cost / lyzr_attributable_leads', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'sponsor'),
        'Meetings booked', 'meetings_booked', 'number', 'tracker', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'sponsor'),
        'Pipeline influenced (USD)', 'pipeline_influenced_usd', 'currency', 'tracker', 5,
        'Manual entry per spec §13')
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'sponsor'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'sponsor'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'sponsor'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Events > Attending (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'attending'),
        'Event name', 'event_name', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'attending'),
        'Event date range', 'event_date_range', 'date_range', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'attending'),
        'Lyzr attendees', 'lyzr_attendees', 'multi_select', 'planning', 3,
        'Pulls from users')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'attending'),
        'Goal', 'goal', 'dropdown', 'planning',
        '["lead_gen","networking","content_capture","partner_meetings"]'::jsonb, 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'attending'),
        'Target meetings', 'target_meetings', 'number', 'planning', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Events > Attending (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'attending'),
        'Meetings held', 'meetings_held', 'number', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'attending'),
        'Lyzr attributable leads', 'lyzr_attributable_leads', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'attending'),
        'Pipeline influenced (USD)', 'pipeline_influenced_usd', 'currency', 'tracker', 3,
        'Manual entry per spec §13')
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'attending'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'attending'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'attending'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Events > Workshops (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Workshop name', 'workshop_name', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Event date', 'event_date', 'date', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Format', 'format', 'dropdown', 'planning',
        '["in_person","virtual","hybrid"]'::jsonb, 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Registration target', 'registration_target', 'number', 'planning', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Venue', 'venue', 'text', 'planning', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Co-host or partner', 'co_host_or_partner', 'text', 'planning', 6)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Events > Workshops (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Registrations', 'registrations', 'number', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Attendees', 'attendees', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Show up rate', 'show_up_rate', 'number', 'tracker', TRUE,
        'attendees / registrations * 100', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Lyzr attributable leads', 'lyzr_attributable_leads', 'number', 'tracker', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Meetings booked', 'meetings_booked', 'number', 'tracker', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Pipeline influenced (USD)', 'pipeline_influenced_usd', 'currency', 'tracker', 6,
        'Manual entry per spec §13')
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'workshops'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Events > Stalls (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'stalls'),
        'Event name', 'event_name', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'stalls'),
        'Event date range', 'event_date_range', 'date_range', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'stalls'),
        'Booth size', 'booth_size', 'text', 'planning', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'stalls'),
        'Booth cost', 'booth_cost', 'currency', 'planning', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'stalls'),
        'Staff assigned', 'staff_assigned', 'multi_select', 'planning', 5,
        'Pulls from users')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'stalls'),
        'Collateral needed', 'collateral_needed', 'long_text', 'planning', 6)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Events > Stalls (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'stalls'),
        'Total visitors', 'total_visitors', 'number', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'stalls'),
        'Lyzr attributable leads', 'lyzr_attributable_leads', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'stalls'),
        'Cost per lead', 'cost_per_lead', 'currency', 'tracker', TRUE,
        'booth_cost / lyzr_attributable_leads', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'stalls'),
        'Meetings booked', 'meetings_booked', 'number', 'tracker', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'stalls'),
        'Pipeline influenced (USD)', 'pipeline_influenced_usd', 'currency', 'tracker', 5,
        'Manual entry per spec §13')
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'stalls'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'stalls'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'stalls'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Co-marketing > Webinar (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Type', 'type', 'dropdown', 'planning',
        '["hosted","attending"]'::jsonb, 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Webinar title', 'webinar_title', 'text', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Partner or host', 'partner_or_host', 'text', 'planning', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Webinar date', 'webinar_date', 'date', 'planning', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Lyzr speaker', 'lyzr_speaker', 'person', 'planning', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Registration URL', 'registration_url', 'url', 'planning', 6)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Platform', 'platform', 'dropdown', 'planning',
        '["linkedin_live","zoom","riverside","other"]'::jsonb, 7)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Co-marketing > Webinar (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Recording URL', 'recording_url', 'url', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Registrations', 'registrations', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Attendees', 'attendees', 'number', 'tracker', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Show up rate', 'show_up_rate', 'number', 'tracker', TRUE,
        'attendees / registrations * 100', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'MQLs generated', 'mqls_generated', 'number', 'tracker', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Replay views', 'replay_views', 'number', 'tracker', 6)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Pipeline influenced (USD)', 'pipeline_influenced_usd', 'currency', 'tracker', 7,
        'Manual entry per spec §13')
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'webinar'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Co-marketing > Podcast (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'podcast'),
        'Type', 'type', 'dropdown', 'planning',
        '["hosted","attending"]'::jsonb, 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'podcast'),
        'Podcast name', 'podcast_name', 'text', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'podcast'),
        'Episode title', 'episode_title', 'text', 'planning', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'podcast'),
        'Recording date', 'recording_date', 'date', 'planning', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'podcast'),
        'Publish date', 'publish_date', 'date', 'planning', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'podcast'),
        'Lyzr guest or host', 'lyzr_guest_or_host', 'person', 'planning', 6)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'podcast'),
        'Other party', 'other_party', 'text', 'planning', 7)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Co-marketing > Podcast (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'podcast'),
        'Published episode URL', 'published_episode_url', 'url', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'podcast'),
        'Plays or downloads', 'plays_or_downloads', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'podcast'),
        'Social mentions', 'social_mentions', 'number', 'tracker', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'podcast'),
        'Inbound inquiries attributed', 'inbound_inquiries_attributed', 'number', 'tracker', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'podcast'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'podcast'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'podcast'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Co-marketing > Testimonial (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'testimonial'),
        'Customer / partner name', 'customer_partner_name', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'testimonial'),
        'Product featured', 'product_featured', 'multi_select', 'planning',
        '["Jazon","Skott","Diane","Jeff","Dwight","Kathy","Cognis","LyzrGPT","GitAgent","Architect"]'::jsonb, 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'testimonial'),
        'Format', 'format', 'dropdown', 'planning',
        '["video","written","audio"]'::jsonb, 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'testimonial'),
        'Length target', 'length_target', 'text', 'planning', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'testimonial'),
        'Usage rights', 'usage_rights', 'dropdown', 'planning',
        '["full","marketing_only","web_only","time_limited"]'::jsonb, 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Co-marketing > Testimonial (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'testimonial'),
        'Final asset URL', 'final_asset_url', 'url', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'testimonial'),
        'Usage placements', 'usage_placements', 'long_text', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'testimonial'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'testimonial'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'testimonial'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Growth Hack > Survey (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'survey'),
        'Target account or industry', 'target_account_or_industry', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'survey'),
        'Number of folks target', 'number_of_folks_target', 'number', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'survey'),
        'Survey platform', 'survey_platform', 'text', 'planning', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'survey'),
        'Survey URL', 'survey_url', 'url', 'planning', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Growth Hack > Survey (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'survey'),
        'Total respondents', 'total_respondents', 'number', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'survey'),
        'Report asset URL', 'report_asset_url', 'url', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'survey'),
        'Distribution reach', 'distribution_reach', 'number', 'tracker', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'survey'),
        'Inbound inquiries attributed', 'inbound_inquiries_attributed', 'number', 'tracker', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'survey'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'survey'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'survey'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Growth Hack > Spotlights (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'spotlights'),
        'Featured account or partner', 'featured_account_or_partner', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'spotlights'),
        'Number of folks target', 'number_of_folks_target', 'number', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'spotlights'),
        'Format', 'format', 'dropdown', 'planning',
        '["written","video","audio"]'::jsonb, 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Growth Hack > Spotlights (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'spotlights'),
        'Published URL', 'published_url', 'url', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'spotlights'),
        'Distribution reach', 'distribution_reach', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'spotlights'),
        'Inbound inquiries attributed', 'inbound_inquiries_attributed', 'number', 'tracker', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'spotlights'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'spotlights'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'spotlights'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Outbound > Instantly (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Email subject draft', 'email_subject_draft', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Tracking link', 'tracking_link', 'url', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Number of people target', 'number_of_people_target', 'number', 'planning', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Total accounts to send', 'total_accounts_to_send', 'number', 'planning', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Expected outcome', 'expected_outcome', 'long_text', 'planning', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'CTA', 'cta', 'text', 'planning', 6)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Outbound > Instantly (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Total sends', 'total_sends', 'number', 'tracker', 1, 'TOFU')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Total opens', 'total_opens', 'number', 'tracker', 2, 'MOFU')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Total engagements', 'total_engagements', 'number', 'tracker', 3, 'MOFU')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Open rate', 'open_rate', 'number', 'tracker', TRUE,
        'total_opens / total_sends * 100', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Engagement rate', 'engagement_rate', 'number', 'tracker', TRUE,
        'total_engagements / total_sends * 100', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Total conversions', 'total_conversions', 'number', 'tracker', 6, 'BOFU')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Demos booked', 'demos_booked', 'number', 'tracker', 7, 'BOFU')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Conversion rate', 'conversion_rate', 'number', 'tracker', TRUE,
        'total_conversions / total_sends * 100', 8)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'instantly'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Outbound > PhantomBuster (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'Target persona', 'target_persona', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'Number of people target', 'number_of_people_target', 'number', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'PhantomBuster phantom name', 'phantombuster_phantom_name', 'text', 'planning', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'Expected outcome', 'expected_outcome', 'long_text', 'planning', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'CTA', 'cta', 'text', 'planning', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Outbound > PhantomBuster (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'Connection requests sent', 'connection_requests_sent', 'number', 'tracker', 1, 'TOFU')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'Accepted', 'accepted', 'number', 'tracker', 2, 'MOFU')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'Replied', 'replied', 'number', 'tracker', 3, 'MOFU')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'Acceptance rate', 'acceptance_rate', 'number', 'tracker', TRUE,
        'accepted / connection_requests_sent * 100', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'Reply rate', 'reply_rate', 'number', 'tracker', TRUE,
        'replied / accepted * 100', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'Demos booked', 'demos_booked', 'number', 'tracker', 6, 'BOFU')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'Conversion rate', 'conversion_rate', 'number', 'tracker', TRUE,
        'demos_booked / connection_requests_sent * 100', 7)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'phantombuster'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Outbound > HubSpot > Email sequences > ICP (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'icp'),
        'Sequence name', 'sequence_name', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'icp'),
        'Target accounts list URL', 'target_accounts_list_url', 'url', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'icp'),
        'Sequence length (days)', 'sequence_length_days', 'number', 'planning', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'icp'),
        'Optimization target', 'optimization_target', 'text', 'planning', 4,
        'Default: demos_booked')
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Outbound > HubSpot > Email sequences > ICP (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'icp'),
        'Total sends', 'total_sends', 'number', 'tracker', 1, 'TOFU')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'icp'),
        'Total opens', 'total_opens', 'number', 'tracker', 2, 'MOFU')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'icp'),
        'Total engagements', 'total_engagements', 'number', 'tracker', 3, 'MOFU')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'icp'),
        'Open rate', 'open_rate', 'number', 'tracker', TRUE,
        'total_opens / total_sends * 100', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'icp'),
        'Engagement rate', 'engagement_rate', 'number', 'tracker', TRUE,
        'total_engagements / total_sends * 100', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'icp'),
        'Demos booked', 'demos_booked', 'number', 'tracker', 6, 'BOFU (optimization target)')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'icp'),
        'Demo booking rate', 'demo_booking_rate', 'number', 'tracker', TRUE,
        'demos_booked / total_sends * 100', 7)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'icp'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'icp'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'icp'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Outbound > HubSpot > Email sequences > Non-ICP (planning)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Sequence name', 'sequence_name', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Target accounts list URL', 'target_accounts_list_url', 'url', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Sequence length (days)', 'sequence_length_days', 'number', 'planning', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Optimization target', 'optimization_target', 'text', 'planning', 4,
        'Default: referrals')
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Outbound > HubSpot > Email sequences > Non-ICP (tracker)
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Total sends', 'total_sends', 'number', 'tracker', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Total opens', 'total_opens', 'number', 'tracker', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Total engagements', 'total_engagements', 'number', 'tracker', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Open rate', 'open_rate', 'number', 'tracker', TRUE,
        'total_opens / total_sends * 100', 4)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Engagement rate', 'engagement_rate', 'number', 'tracker', TRUE,
        'total_engagements / total_sends * 100', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Referrals secured', 'referrals_secured', 'number', 'tracker', 6, 'BOFU (optimization target)')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Senior intros from referrals', 'senior_intros_from_referrals', 'number', 'tracker', 7)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, is_auto_calc, formula, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Referral rate', 'referral_rate', 'number', 'tracker', TRUE,
        'referrals_secured / total_sends * 100', 8)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- Universal tracker fields
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Insights', 'insights', 'long_text', 'tracker', 97,
        'Numbered list of learnings, what worked, what did not. Supports @mentions.')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Result URL', 'result_url', 'url', 'tracker', 98)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'non-icp'),
        'Result file', 'result_file', 'file', 'tracker', 99)
ON CONFLICT (channel_id, slug) DO NOTHING;


-- ============================================================
-- Leads Pipeline > All leads (planning only — no tracker fields per spec)
-- ============================================================
INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'all-leads'),
        'Name', 'name', 'text', 'planning', 1)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'all-leads'),
        'Email', 'email', 'email', 'planning', 2)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'all-leads'),
        'Company', 'company', 'text', 'planning', 3)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order, description)
VALUES ((SELECT id FROM channels WHERE slug = 'all-leads'),
        'Source channel', 'source_channel', 'text', 'planning', 4,
        'Free text, references where the lead came from')
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'all-leads'),
        'Generated date', 'generated_date', 'date', 'planning', 5)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, options, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'all-leads'),
        'Lead status', 'lead_status', 'dropdown', 'planning',
        '["new","contacted","qualified","unqualified","converted","lost"]'::jsonb, 6)
ON CONFLICT (channel_id, slug) DO NOTHING;

INSERT INTO channel_fields (channel_id, name, slug, field_type, surface, sort_order)
VALUES ((SELECT id FROM channels WHERE slug = 'all-leads'),
        'Notes', 'notes', 'long_text', 'planning', 7)
ON CONFLICT (channel_id, slug) DO NOTHING;

-- ============================================================
-- End of migration 006
-- ============================================================
