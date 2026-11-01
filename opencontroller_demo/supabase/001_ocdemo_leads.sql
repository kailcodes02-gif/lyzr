-- opencontroller demo (https://lyzr.kailash-gm.com/opencontroller_demo/): who signed in to the demo,
-- and which screens they opened. Run once in the SQL editor of the Supabase project behind the
-- Pages secret CA_SUPABASE_URL (the Campaign Analytics project). Only creates ocdemo_* objects;
-- safe to run twice.
--
-- Written and read by the Pages Functions in functions/api/ocdemo/ with the service-role key only
-- (CA_SUPABASE_KEY): RLS on, no policies, like the ca_* tables.

create table if not exists ocdemo_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  company text,
  title text,
  audience text not null check (audience in ('lyzr', 'external')),
  auth_method text not null,               -- microsoft | email_code | email_domain
  domain text,
  country text,                            -- from Cloudflare (cf-ipcountry)
  user_agent text,
  referrer text,
  utm jsonb,
  visits int not null default 1,           -- sign-ins
  screens_viewed int not null default 0,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists ocdemo_events (
  id bigint generated always as identity primary key,
  lead_id uuid not null references ocdemo_leads(id) on delete cascade,
  kind text not null,                      -- signin | view | action | cta
  screen text,                             -- e.g. /shadow-ai
  detail text,                             -- e.g. "Registered claude-opus-5-5"
  at timestamptz not null default now()
);
create index if not exists ocdemo_events_lead on ocdemo_events(lead_id, at desc);
create index if not exists ocdemo_events_at on ocdemo_events(at desc);

alter table ocdemo_leads enable row level security;
alter table ocdemo_events enable row level security;
