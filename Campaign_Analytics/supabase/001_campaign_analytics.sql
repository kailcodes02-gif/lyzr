-- Campaign Analytics (Campaign_Analytics/) schema. All tables are prefixed ca_.
-- Access model: only the Pages Functions under functions/api/ca/ talk to these
-- tables, using the service-role key (CA_SUPABASE_KEY). RLS is enabled with no
-- policies, so the anon/publishable key can read nothing.
create extension if not exists pgcrypto;

-- One row per file the team uploads (any cadence: LinkedIn Performance + Demographics, Instantly event exports).
create table if not exists ca_uploads (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'linkedin',            -- linkedin | email
  kind text not null,                                   -- performance | demographics
  file_name text,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  period_start date,                                    -- window the export covers
  period_end date,
  row_count int not null default 0,
  columns jsonb,                                        -- raw header -> mapped field, for audit
  notes text
);

-- LinkedIn ad performance, one row per ad per day. Overlapping uploads simply
-- overwrite the same (day, campaign, ad) cell: last upload wins.
create table if not exists ca_li_perf (
  day date not null,
  campaign_id text not null default '',
  ad_id text not null default '',
  upload_id uuid references ca_uploads(id) on delete cascade,
  campaign_group text,
  campaign text,
  ad_name text,
  objective text,
  format text,
  impressions numeric not null default 0,
  clicks numeric not null default 0,
  spend numeric not null default 0,
  reach numeric not null default 0,
  leads numeric not null default 0,
  lead_forms_opened numeric not null default 0,
  video_views numeric not null default 0,
  sends numeric not null default 0,
  opens numeric not null default 0,
  engagements numeric not null default 0,
  reactions numeric not null default 0,
  comments numeric not null default 0,
  shares numeric not null default 0,
  follows numeric not null default 0,
  viral_impressions numeric not null default 0,
  conversions numeric not null default 0,
  extra jsonb,
  primary key (day, campaign_id, ad_id)
);
create index if not exists ca_li_perf_day on ca_li_perf(day);

-- LinkedIn demographics, one row per (upload, segment, value[, campaign]).
-- Demographics exports are aggregates over the export window, never per day,
-- so date-range filtering snaps to upload windows.
create table if not exists ca_li_demo (
  id bigserial primary key,
  upload_id uuid not null references ca_uploads(id) on delete cascade,
  segment text not null,      -- Company | Job Title | Job Seniority | Job Function | Country | Location | Company Size | Industry
  value text not null,
  campaign text not null default '',
  impressions numeric not null default 0,
  clicks numeric not null default 0,
  spend numeric not null default 0,
  sends numeric not null default 0,
  opens numeric not null default 0,
  engagements numeric not null default 0,
  leads numeric not null default 0,
  extra jsonb,
  unique (upload_id, segment, value, campaign)
);
create index if not exists ca_li_demo_seg on ca_li_demo(segment, value);

-- HubSpot contacts pulled by the GSI rules (read-only mirror, refreshed on demand).
create table if not exists ca_hs_contacts (
  hs_id text primary key,
  email text,
  first_name text,
  last_name text,
  company_raw text,
  account text,               -- canonical target-account name, null if unmatched
  jobtitle text,
  band text,                  -- MD | MD-1 | MD-2 | Other | Unknown
  country text,
  region text,
  source text,                -- hs_analytics_source
  source_detail text,         -- hs_analytics_source_data_1 / _2
  lead_source text,
  lsa_message text,
  lsa_score numeric,
  lsa_category text,
  lifecycle text,
  lead_status text,
  owner_id text,
  owner_name text,
  created_at timestamptz,
  last_modified timestamptz,
  last_activity_at timestamptz,
  last_activity_type text,
  notes_count int not null default 0,
  via text[] not null default '{}',   -- which pull rules matched: company | owner | gsi_text
  props jsonb,
  synced_at timestamptz not null default now()
);
create index if not exists ca_hs_contacts_created on ca_hs_contacts(created_at);
create index if not exists ca_hs_contacts_account on ca_hs_contacts(account);

-- Notes / logged engagements attached to those contacts (what humans wrote).
create table if not exists ca_hs_notes (
  id text primary key,
  contact_id text not null references ca_hs_contacts(hs_id) on delete cascade,
  kind text not null default 'note',   -- note | email | call | meeting | task
  body text,
  owner_id text,
  created_at timestamptz,
  synced_at timestamptz not null default now()
);
create index if not exists ca_hs_notes_contact on ca_hs_notes(contact_id);

create table if not exists ca_hs_sync (
  id uuid primary key default gen_random_uuid(),
  started_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',  -- running | done | error
  contacts int default 0,
  notes int default 0,
  error text
);

-- Cached Claude outputs, one per scope (e.g. messaging:account:Accenture).
create table if not exists ca_insights (
  scope text primary key,
  input_hash text,
  model text,
  content jsonb not null,
  created_at timestamptz not null default now(),
  created_by text
);

-- Editable configuration: bands, icp_pool, accounts, regions, targets, editors.
create table if not exists ca_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table ca_uploads enable row level security;
alter table ca_li_perf enable row level security;
alter table ca_li_demo enable row level security;
alter table ca_hs_contacts enable row level security;
alter table ca_hs_notes enable row level security;
alter table ca_hs_sync enable row level security;
alter table ca_insights enable row level security;
alter table ca_settings enable row level security;
