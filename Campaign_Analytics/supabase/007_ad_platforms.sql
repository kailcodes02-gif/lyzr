-- Campaign Analytics: ads from more than one platform. LinkedIn rows stay as
-- they are (platform defaults to 'linkedin'); Google, Meta, Bing, Taboola, X
-- and ChatGPT exports land in the same tables with their own platform value.
alter table ca_li_perf add column if not exists platform text not null default 'linkedin';
alter table ca_li_demo add column if not exists platform text not null default 'linkedin';
alter table ca_uploads add column if not exists platform text;
-- The day/campaign/ad key stays unique per platform.
alter table ca_li_perf drop constraint if exists ca_li_perf_pkey;
alter table ca_li_perf add primary key (platform, day, campaign_id, ad_id);
create index if not exists ca_li_perf_platform_day on ca_li_perf(platform, day);
