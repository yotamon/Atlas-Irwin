-- Ensemblis Creative Memory v1
-- Durable, artist-scoped evidence for creative decisions and reusable asset retrieval.

create table if not exists public.creative_memory_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  asset_id uuid null references public.media_assets(id) on delete set null,
  release_id uuid null references public.releases(id) on delete set null,
  track_id uuid null references public.tracks(id) on delete set null,
  moment_id uuid null references public.moments(id) on delete set null,
  video_project_id uuid null references public.music_video_projects(id) on delete set null,
  event_type text not null check (event_type in (
    'direction_selected',
    'direction_rejected',
    'reference_approved',
    'reference_rejected',
    'shot_locked',
    'shot_rejected',
    'shot_replaced',
    'asset_used',
    'asset_exported',
    'performance_observed',
    'preference_signal',
    'exclusion_added',
    'exclusion_removed'
  )),
  sentiment smallint not null default 0 check (sentiment between -1 and 1),
  weight numeric(5,2) not null default 1 check (weight > 0 and weight <= 5),
  signal text null check (signal is null or char_length(signal) <= 500),
  source text not null default 'ensemblis' check (char_length(source) <= 80),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 240),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner_id, artist_id, idempotency_key)
);

create index if not exists creative_memory_events_artist_recent_idx
  on public.creative_memory_events (owner_id, artist_id, created_at desc);
create index if not exists creative_memory_events_asset_idx
  on public.creative_memory_events (owner_id, artist_id, asset_id, created_at desc)
  where asset_id is not null;
create index if not exists creative_memory_events_release_idx
  on public.creative_memory_events (owner_id, artist_id, release_id, created_at desc)
  where release_id is not null;
create index if not exists creative_memory_events_moment_idx
  on public.creative_memory_events (owner_id, artist_id, moment_id, created_at desc)
  where moment_id is not null;

create table if not exists public.creative_asset_profiles (
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  visual_descriptors text[] not null default '{}'::text[],
  semantic_descriptors text[] not null default '{}'::text[],
  brand_relevance real not null default 0.5 check (brand_relevance between 0 and 1),
  excluded boolean not null default false,
  exclusion_reason text null check (exclusion_reason is null or char_length(exclusion_reason) <= 1000),
  duplicate_of_asset_id uuid null references public.media_assets(id) on delete set null,
  duplicate_evidence jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  last_reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, artist_id, asset_id),
  check (duplicate_of_asset_id is null or duplicate_of_asset_id <> asset_id)
);

create index if not exists creative_asset_profiles_artist_rank_idx
  on public.creative_asset_profiles (owner_id, artist_id, excluded, brand_relevance desc, updated_at desc);
create index if not exists creative_asset_profiles_duplicate_idx
  on public.creative_asset_profiles (owner_id, artist_id, duplicate_of_asset_id)
  where duplicate_of_asset_id is not null;

alter table public.creative_memory_events enable row level security;
alter table public.creative_asset_profiles enable row level security;

revoke all on table public.creative_memory_events from anon, authenticated;
revoke all on table public.creative_asset_profiles from anon, authenticated;
grant select, insert on table public.creative_memory_events to authenticated;
grant select, insert, update on table public.creative_asset_profiles to authenticated;

create policy creative_memory_events_owner_select
  on public.creative_memory_events
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy creative_memory_events_owner_insert
  on public.creative_memory_events
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy creative_asset_profiles_owner_select
  on public.creative_asset_profiles
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy creative_asset_profiles_owner_insert
  on public.creative_asset_profiles
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy creative_asset_profiles_owner_update
  on public.creative_asset_profiles
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

comment on table public.creative_memory_events is
  'Append-only artist-scoped creative decisions and usage evidence. Never use owner scope alone for recommendations.';
comment on table public.creative_asset_profiles is
  'Artist-specific reusable-media annotations: descriptors, exclusions, brand relevance and duplicate evidence.';
