-- Active Mastering Studio
-- Rendered candidates remain immutable and separate from the canonical source master.

create table if not exists public.track_mastering_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null,
  track_vault_id uuid not null,
  preset text not null check (preset in ('balanced', 'punchy', 'dynamic')),
  status text not null default 'planned'
    check (status in ('planned', 'queued', 'running', 'completed', 'failed', 'cancelled')),
  idempotency_key text not null unique,
  source_audio_url text not null,
  source_media_asset_id uuid null references public.media_assets(id) on delete set null,
  output_bucket text not null default 'public-media',
  output_path text not null,
  output_asset_id uuid null references public.media_assets(id) on delete set null,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  external_job_id text null,
  error text null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists track_mastering_jobs_track_idx
  on public.track_mastering_jobs(owner_id, artist_id, track_vault_id, created_at desc);

create unique index if not exists track_mastering_jobs_one_active_idx
  on public.track_mastering_jobs(owner_id, artist_id, track_vault_id)
  where status in ('planned', 'queued', 'running');

alter table public.track_mastering_jobs enable row level security;

drop policy if exists "track_mastering_jobs_select_own" on public.track_mastering_jobs;
create policy "track_mastering_jobs_select_own"
  on public.track_mastering_jobs for select
  using (auth.uid() = owner_id);

drop policy if exists "track_mastering_jobs_insert_own" on public.track_mastering_jobs;
create policy "track_mastering_jobs_insert_own"
  on public.track_mastering_jobs for insert
  with check (auth.uid() = owner_id);

drop policy if exists "track_mastering_jobs_update_own" on public.track_mastering_jobs;
create policy "track_mastering_jobs_update_own"
  on public.track_mastering_jobs for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

comment on table public.track_mastering_jobs is
  'Durable Active Mastering jobs. Source masters are immutable; rendered candidates retain DSP and QA lineage.';
