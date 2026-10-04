-- Campaign Analytics: every lead of every GSI-tagged Instantly campaign.
-- Run after 002_email_actions.sql. Only creates ca_* objects.
--
-- Filled by the 'leads' phase of POST /api/ca/instantly/sync (read-only against
-- Instantly: POST /api/v2/leads/list is a read). One row per lead per campaign,
-- so a HubSpot contact can be checked against the GSI sequences by email.
-- Each run re-reads every GSI campaign in full and overwrites its rows.
create table if not exists ca_em_leads (
  campaign_id text not null,               -- Instantly campaign id (ca_em_campaigns.id)
  email text not null,                     -- lead email, lower-case
  campaign_name text,
  gsi boolean not null default true,       -- only GSI campaigns are read today
  status int,                              -- Instantly lead status: 1 active, 2 paused, 3 completed, -1 bounced, -2 unsubscribed, -3 skipped
  interest_status int,                     -- Instantly lt_interest_status (1 interested, 2 meeting booked, 3 meeting completed, 4 closed, -1 not interested, ...)
  open_count int default 0,
  reply_count int default 0,
  click_count int default 0,
  created_at timestamptz,                  -- when the lead was added to the campaign
  last_reply_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (campaign_id, email)
);
create index if not exists ca_em_leads_email on ca_em_leads(email);

alter table ca_em_leads enable row level security;
