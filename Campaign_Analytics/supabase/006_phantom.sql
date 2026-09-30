-- Campaign Analytics: PhantomBuster (LinkedIn automation) mirror.
-- Run after 005. Only creates ca_pb_* objects. Filled by
-- functions/api/ca/phantom/sync.js (read-only against PhantomBuster).

-- One row per phantom (PhantomBuster "agent") in the workspace.
create table if not exists ca_pb_agents (
  id text primary key,                     -- PhantomBuster agent id
  name text not null,
  script text,                             -- e.g. "LinkedIn Auto Connect.js", "LinkedIn Outreach.js"
  last_run_at timestamptz,                 -- lastEndedAt from the API
  status text,                             -- lastEndType: finished | error | ... ; "running" when a container is live
  raw jsonb,                               -- the agent object minus its manifest
  synced_at timestamptz not null default now()
);

-- One row per run (PhantomBuster "container") of an outreach phantom, with the
-- counts derived from the run's result file: rows = profiles processed, and
-- rows whose flags or status say an invite, an acceptance, a message or a
-- reply happened.
create table if not exists ca_pb_runs (
  id text primary key,                     -- container id
  agent_id text not null references ca_pb_agents(id) on delete cascade,
  launched_at timestamptz,                 -- container createdAt
  ended_at timestamptz,                    -- container endedAt
  status text,                             -- finished | error | launch error | ...
  profiles int default 0,
  invites_sent int default 0,
  accepted int default 0,
  messages_sent int default 0,
  replies int default 0,
  raw jsonb,                               -- container object plus how the counts were derived
  synced_at timestamptz not null default now()
);
create index if not exists ca_pb_runs_agent on ca_pb_runs(agent_id, launched_at);
create index if not exists ca_pb_runs_launched on ca_pb_runs(launched_at);

-- Runs rolled up per phantom and launch day (IST calendar day). Rebuilt from
-- ca_pb_runs at the end of every sync.
create table if not exists ca_pb_daily (
  agent_id text not null references ca_pb_agents(id) on delete cascade,
  day date not null,
  profiles int default 0,
  invites_sent int default 0,
  accepted int default 0,
  messages_sent int default 0,
  replies int default 0,
  synced_at timestamptz not null default now(),
  primary key (agent_id, day)
);
create index if not exists ca_pb_daily_day on ca_pb_daily(day);

create table if not exists ca_pb_sync (
  id uuid primary key default gen_random_uuid(),
  started_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  agents int default 0,
  runs int default 0,
  error text
);

alter table ca_pb_agents enable row level security;
alter table ca_pb_runs enable row level security;
alter table ca_pb_daily enable row level security;
alter table ca_pb_sync enable row level security;
