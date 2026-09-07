-- Ensemblis AutoMix Studio
-- Durable, artist-owned DJ mix jobs over canonical track masters.

create table if not exists public.automix_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'AutoMix',
  purpose text not null default 'booking'
    check (purpose in ('booking','soundcloud','journey','peak_time','warm_up','discovery')),
  energy_profile text not null default 'dynamic'
    check (energy_profile in ('smooth','dynamic','peak')),
  transition_style text not null default 'dj'
    check (transition_style in ('clean','dj','creative')),
  output_format text not null default 'mp3'
    check (output_format in ('mp3','wav')),
  target_duration_ms integer not null default 1200000
    check (target_duration_ms between 90000 and 3600000),
  track_ids uuid[] not null,
  source_fingerprints jsonb not null default '[]'::jsonb,
  status text not null default 'planned'
    check (status in ('planned','queued','running','completed','failed','cancelled')),
  idempotency_key text not null unique,
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
  updated_at timestamptz not null default now(),
  check (cardinality(track_ids) between 2 and 20),
  check (jsonb_typeof(source_fingerprints) = 'array')
);

create index if not exists automix_jobs_owner_idx
  on public.automix_jobs(owner_id, created_at desc);

create unique index if not exists automix_jobs_one_active_identical_idx
  on public.automix_jobs(owner_id, idempotency_key)
  where status in ('planned','queued','running');

create or replace function private.validate_automix_job_tracks()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_track_id uuid;
  v_owner uuid;
begin
  if cardinality(new.track_ids) < 2 or cardinality(new.track_ids) > 20 then
    raise exception 'AutoMix requires between 2 and 20 tracks';
  end if;
  if (select count(distinct item) from unnest(new.track_ids) item) <> cardinality(new.track_ids) then
    raise exception 'AutoMix track list cannot contain duplicates';
  end if;
  foreach v_track_id in array new.track_ids loop
    select t.owner_id into v_owner from public.tracks t where t.id = v_track_id;
    if v_owner is null then raise exception 'AutoMix track % does not exist', v_track_id; end if;
    if v_owner <> new.owner_id then raise exception 'AutoMix tracks must belong to the job owner'; end if;
  end loop;
  return new;
end;
$$;

revoke all on function private.validate_automix_job_tracks() from public, anon, authenticated;

drop trigger if exists automix_jobs_validate_tracks on public.automix_jobs;
create trigger automix_jobs_validate_tracks
  before insert or update of owner_id, track_ids
  on public.automix_jobs
  for each row execute function private.validate_automix_job_tracks();

drop trigger if exists set_automix_jobs_updated_at on public.automix_jobs;
create trigger set_automix_jobs_updated_at
  before update on public.automix_jobs
  for each row execute function private.set_updated_at();

alter table public.automix_jobs enable row level security;

drop policy if exists "automix_jobs_select_own" on public.automix_jobs;
create policy "automix_jobs_select_own"
  on public.automix_jobs for select to authenticated
  using (auth.uid() = owner_id and private.is_studio_admin());

drop policy if exists "automix_jobs_insert_own" on public.automix_jobs;
create policy "automix_jobs_insert_own"
  on public.automix_jobs for insert to authenticated
  with check (auth.uid() = owner_id and private.is_studio_admin());

drop policy if exists "automix_jobs_update_own" on public.automix_jobs;
create policy "automix_jobs_update_own"
  on public.automix_jobs for update to authenticated
  using (auth.uid() = owner_id and private.is_studio_admin())
  with check (auth.uid() = owner_id and private.is_studio_admin());

grant select, insert, update on public.automix_jobs to authenticated;

comment on table public.automix_jobs is
  'Durable Ensemblis AutoMix jobs. Inputs are canonical track masters with Music, Mastering and optional Stem Intelligence lineage.';
