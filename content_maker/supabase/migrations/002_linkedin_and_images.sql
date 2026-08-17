-- Sales Copilot — Phase 2 additions: LinkedIn post generation + inline
-- image storage (base64 in a column, avoiding a separate Storage bucket
-- setup for this pass).

-- ── linkedin_voice_samples ──────────────────────────────────────────────
-- The 5-6 sample posts each rep uploads once to define their base tone.
create table if not exists linkedin_voice_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

alter table linkedin_voice_samples enable row level security;

create policy "linkedin_voice_samples: read own" on linkedin_voice_samples
  for select using (user_id = auth.uid());

create policy "linkedin_voice_samples: insert own" on linkedin_voice_samples
  for insert with check (user_id = auth.uid());

create policy "linkedin_voice_samples: delete own" on linkedin_voice_samples
  for delete using (user_id = auth.uid());

-- ── linkedin_posts ──────────────────────────────────────────────────────
create table if not exists linkedin_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text,
  content text not null,
  image_data_url text,
  created_at timestamptz not null default now()
);

alter table linkedin_posts enable row level security;

create policy "linkedin_posts: read own" on linkedin_posts
  for select using (user_id = auth.uid());

create policy "linkedin_posts: insert own" on linkedin_posts
  for insert with check (user_id = auth.uid());

create policy "linkedin_posts: delete own" on linkedin_posts
  for delete using (user_id = auth.uid());

-- ── email image support ────────────────────────────────────────────────
alter table email_drafts add column if not exists image_data_url text;
alter table email_drafts add column if not exists tone_override text;
