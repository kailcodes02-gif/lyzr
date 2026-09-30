-- Campaign Analytics: the GSI/SI conversations pipeline (HubSpot deals).
-- Run after 003_message_ai.sql. Only creates ca_* objects; nothing else is
-- read or changed. Filled by functions/api/ca/hubspot/deals-sync.js, which is
-- read-only against HubSpot.

-- One row per HubSpot deal that is a GSI/SI conversation: either the deal's
-- `gsi` property is set, or an associated company is on the GSI account list
-- (Settings › accounts). `bucket` is the coarse stage the widget charts by;
-- `substage` is the HubSpot stage label of the deal's own pipeline.
create table if not exists ca_hs_deals (
  hs_id text primary key,
  name text,
  pipeline text,                          -- HubSpot pipeline id
  pipeline_label text,
  stage text,                             -- HubSpot stage id
  stage_label text,
  bucket text,                            -- conversation | demo | won | lost
  substage text,                          -- stage label (what the report called sub-stage)
  amount numeric,
  close_date date,
  created_at timestamptz,                 -- HubSpot createdate
  partner text,                           -- canonical GSI account name
  company_raw text,                       -- associated company name (or the gsi property)
  dealtype text,                          -- HubSpot dealtype value
  motion_label text,                      -- New Business | Expansion | Partnership | POC
  forecast text,                          -- forecast category label
  via text[] default '{}',                -- gsi_property | company_match
  props jsonb default '{}',
  synced_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_stage_change_at timestamptz,
  prev_stage text                         -- stage label before the last change
);
create index if not exists ca_hs_deals_partner on ca_hs_deals(partner);
create index if not exists ca_hs_deals_bucket on ca_hs_deals(bucket);
create index if not exists ca_hs_deals_close on ca_hs_deals(close_date);

-- What changed: one row per new deal, stage move, amount change or close, so
-- "what changed since last week" is a range query on `at`.
create table if not exists ca_hs_deal_history (
  id bigserial primary key,
  hs_id text not null,
  at timestamptz not null default now(),
  kind text not null,                     -- new | stage | amount | closed
  from_value text,
  to_value text,
  amount numeric
);
create index if not exists ca_hs_deal_history_at on ca_hs_deal_history(at);
create index if not exists ca_hs_deal_history_deal on ca_hs_deal_history(hs_id);

-- One row per sync run (same shape as ca_hs_sync).
create table if not exists ca_hs_deals_sync (
  id uuid primary key default gen_random_uuid(),
  started_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',  -- running | done | error
  deals int default 0,
  changes int default 0,
  error text
);

alter table ca_hs_deals enable row level security;
alter table ca_hs_deal_history enable row level security;
alter table ca_hs_deals_sync enable row level security;
