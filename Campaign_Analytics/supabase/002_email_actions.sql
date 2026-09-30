-- Campaign Analytics: email channel (Instantly) and the tracked action list.
-- Run after 001_campaign_analytics.sql. Only creates ca_* objects.

-- One row per Instantly event from the per-campaign "analytics" CSV export
-- (columns: Associated account, Contact, Step, Event, Link Clicked, Created At).
-- Exports are cumulative, so the same event arrives again in every later
-- export of that campaign: the natural key below makes re-uploads idempotent
-- (the newest upload owns the row).
create table if not exists ca_em_events (
  campaign text not null,                 -- from the file name, editable before upload
  contact text not null,                  -- prospect email, lower-case
  step int not null default 0,            -- 1..n, 0 when the export has none
  event text not null,                    -- sent | opened | clicked | bounced | auto_reply | replied | unsubscribed | other
  ts timestamptz not null,                -- Created At (UTC in the export)
  upload_id uuid references ca_uploads(id) on delete cascade,
  sender text,                            -- Associated account (our mailbox)
  link text not null default '',          -- Link Clicked (clicked events only)
  lag_s numeric,                          -- clicked: seconds since the Sent of the same step (fast = likely scanner)
  raw_event text,                         -- event label exactly as exported
  primary key (campaign, contact, step, event, ts, link)
);
create index if not exists ca_em_events_ts on ca_em_events(ts);
create index if not exists ca_em_events_contact on ca_em_events(contact);

-- Suggestions and to-dos per channel. Claude findings can be tracked here;
-- the next Claude read-out receives this list so it can say what was done.
create table if not exists ca_actions (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'overview',   -- overview | linkedin | email | leads | messaging
  title text not null,
  detail text,
  owner text,
  status text not null default 'open',       -- open | done | dropped
  source text not null default 'manual',     -- manual | ai
  scope text,                                -- insight scope it came from
  due date,
  note text,                                 -- what happened / outcome
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists ca_actions_channel on ca_actions(channel, status);


-- Instantly API mirror (daily sync, read-only against Instantly). Campaigns
-- tagged GSI in Instantly; names match the CSV export file names, which is
-- how CSV events and API numbers line up.
create table if not exists ca_em_campaigns (
  id text primary key,                     -- Instantly campaign id
  name text not null,
  status int,                              -- 0 draft, 1 active, 2 paused, 3 completed
  gsi boolean not null default true,
  leads_count numeric default 0,
  contacted numeric default 0,
  sent numeric default 0,
  new_leads_contacted numeric default 0,
  opened_unique numeric default 0,
  clicked_unique numeric default 0,
  replied_unique numeric default 0,
  replies_automatic numeric default 0,
  bounced numeric default 0,
  unsubscribed numeric default 0,
  completed numeric default 0,
  opportunities numeric default 0,
  created_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create table if not exists ca_em_daily (
  campaign_id text not null references ca_em_campaigns(id) on delete cascade,
  day date not null,
  sent numeric default 0,
  contacted numeric default 0,
  new_leads_contacted numeric default 0,
  opened numeric default 0,
  unique_opened numeric default 0,
  replies numeric default 0,
  unique_replies numeric default 0,
  replies_automatic numeric default 0,
  clicks numeric default 0,
  unique_clicks numeric default 0,
  opportunities numeric default 0,
  synced_at timestamptz not null default now(),
  primary key (campaign_id, day)
);
create index if not exists ca_em_daily_day on ca_em_daily(day);

create table if not exists ca_em_sync (
  id uuid primary key default gen_random_uuid(),
  started_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  campaigns int default 0,
  days int default 0,
  error text
);

alter table ca_em_campaigns enable row level security;
alter table ca_em_daily enable row level security;
alter table ca_em_sync enable row level security;
alter table ca_em_events enable row level security;
alter table ca_actions enable row level security;
