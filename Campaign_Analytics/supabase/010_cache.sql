-- Campaign Analytics: shared response cache for the heavy GET endpoints. Run after 009.
-- Only creates ca_* objects; safe to run twice.
--
-- One row per path + params (key), holding the JSON body the API sent, so the data computed once
-- stays for 8 hours for every user, across logins and date ranges (functions/api/ca/_lib/cache.js).
-- The sentinel row `_version` holds the time of the last data write (uploads, settings, syncs):
-- entries stored before it are ignored. "Refresh data" in the top bar recomputes and overwrites.
-- Written by the Pages Functions with the service-role key only; no policies, like the other tables.
create table if not exists ca_cache (
  key text primary key,                    -- e.g. v1:linkedin?from=2026-09-01&platform=linkedin&to=2026-09-30
  body text not null,                      -- serialized JSON response (ISO timestamp for _version)
  bytes int,
  at timestamptz not null default now()    -- when the body was computed
);
create index if not exists ca_cache_at on ca_cache(at);

alter table ca_cache enable row level security;

insert into ca_cache (key, body, bytes, at)
values ('_version', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 24, now())
on conflict (key) do nothing;
