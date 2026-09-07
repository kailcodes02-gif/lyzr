-- Sales Copilot — Phase 1 schema (Auth + Email generation)
-- Phase 2 (LinkedIn, full KB/RAG with pgvector, generated documents) adds
-- tables/columns later without needing to rework this schema.

create extension if not exists "pgcrypto";

-- ── profiles ────────────────────────────────────────────────────────────
-- Mirrors auth.users; enforces @lyzr.ai and gives us a place to hang role.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'sales' check (role in ('sales', 'partnerships', 'admin')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles: read own" on profiles
  for select using (auth.uid() = id);

create policy "profiles: update own" on profiles
  for update using (auth.uid() = id);

-- Populate profiles on signup; reject non-lyzr.ai domains at the trigger level
-- as defense-in-depth (the OAuth callback route also checks the `hd` claim).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.email is null or new.email !~ '^[^@]+@lyzr\.ai$' then
    raise exception 'Only @lyzr.ai accounts are permitted';
  end if;

  insert into profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── google_connections ─────────────────────────────────────────────────
-- Encrypted Google OAuth refresh token per user, captured once at login
-- (Supabase Auth only surfaces provider_refresh_token in the initial
-- callback exchange). No RLS policies granted — only the service-role
-- client (server-side) may read/write this table.
create table if not exists google_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_refresh_token text not null,
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  connected_at timestamptz not null default now()
);

alter table google_connections enable row level security;

-- ── kb_entries ──────────────────────────────────────────────────────────
-- Phase 1 minimal knowledge base: paste-only text content. No embedding
-- column yet — relevance is simple tag/keyword filtering at this volume.
-- File upload + Gemini OCR + pgvector RAG land in Phase 2.
create table if not exists kb_entries (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content_md text not null,
  source_type text not null default 'paste'
    check (source_type in ('upload', 'paste', 'email_thread', 'meeting_transcript')),
  scope text not null default 'global' check (scope in ('global', 'private')),
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table kb_entries enable row level security;

create policy "kb_entries: read global or own" on kb_entries
  for select using (scope = 'global' or uploaded_by = auth.uid());

create policy "kb_entries: insert own" on kb_entries
  for insert with check (uploaded_by = auth.uid());

create policy "kb_entries: update own" on kb_entries
  for update using (uploaded_by = auth.uid());

create policy "kb_entries: delete own" on kb_entries
  for delete using (uploaded_by = auth.uid());

-- ── hubspot_activity_cache ─────────────────────────────────────────────
-- Cached HubSpot engagement pull per contact email (BOFU sourcing).
-- Shared company CRM data — readable by any authenticated user; only the
-- server (service role) writes to it.
create table if not exists hubspot_activity_cache (
  contact_email text primary key,
  raw_activity jsonb not null,
  summary_md text,
  fetched_at timestamptz not null default now()
);

alter table hubspot_activity_cache enable row level security;

create policy "hubspot_activity_cache: read all" on hubspot_activity_cache
  for select using (auth.role() = 'authenticated');

-- ── email_drafts ────────────────────────────────────────────────────────
create table if not exists email_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  funnel_tier text not null check (funnel_tier in ('tofu', 'mofu', 'bofu')),
  mode text not null check (mode in ('thread', 'general')),
  contact_email text,
  subject text not null,
  body_md text not null,
  gmail_draft_id text,
  status text not null default 'generated' check (status in ('generated', 'saved_to_gmail')),
  created_at timestamptz not null default now()
);

alter table email_drafts enable row level security;

create policy "email_drafts: read own" on email_drafts
  for select using (user_id = auth.uid());

create policy "email_drafts: insert own" on email_drafts
  for insert with check (user_id = auth.uid());

create policy "email_drafts: update own" on email_drafts
  for update using (user_id = auth.uid());

create policy "email_drafts: delete own" on email_drafts
  for delete using (user_id = auth.uid());
