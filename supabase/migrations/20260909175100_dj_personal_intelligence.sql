-- Ensemblis Personal DJ Intelligence
-- Bounded, inspectable artist-scoped preferences and feedback evidence for Set Intelligence.

create table if not exists public.dj_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  explicit_preferences jsonb not null default '{}'::jsonb,
  learned_preferences jsonb not null default '{}'::jsonb,
  learned_confidence real not null default 0 check (learned_confidence between 0 and 1),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  profile_version integer not null default 1 check (profile_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, artist_id),
  check (jsonb_typeof(explicit_preferences) = 'object'),
  check (jsonb_typeof(learned_preferences) = 'object')
);

create index if not exists dj_profiles_artist_idx
  on public.dj_profiles(artist_id, updated_at desc);

create table if not exists public.dj_preference_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  automix_job_id uuid not null references public.automix_jobs(id) on delete cascade,
  evidence_type text not null default 'plan_feedback'
    check (evidence_type in ('plan_feedback')),
  verdict text not null check (verdict in ('accepted','rejected')),
  signal jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, artist_id, automix_job_id, evidence_type),
  check (jsonb_typeof(signal) = 'object')
);

create index if not exists dj_preference_evidence_artist_idx
  on public.dj_preference_evidence(owner_id, artist_id, created_at desc);

create or replace function private.validate_dj_preference_evidence_job()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_artist uuid;
begin
  select job.owner_id, job.artist_id
    into v_owner, v_artist
    from public.automix_jobs job
    where job.id = new.automix_job_id;

  if v_owner is null then
    raise exception 'DJ preference evidence requires an existing AutoMix job';
  end if;
  if v_owner <> new.owner_id or v_artist <> new.artist_id then
    raise exception 'DJ preference evidence must match the AutoMix job owner and artist';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_dj_preference_evidence_job() from public, anon, authenticated;

drop trigger if exists dj_preference_evidence_validate_job on public.dj_preference_evidence;
create trigger dj_preference_evidence_validate_job
  before insert or update of owner_id, artist_id, automix_job_id
  on public.dj_preference_evidence
  for each row execute function private.validate_dj_preference_evidence_job();

drop trigger if exists set_dj_profiles_updated_at on public.dj_profiles;
create trigger set_dj_profiles_updated_at
  before update on public.dj_profiles
  for each row execute function private.set_updated_at();

drop trigger if exists set_dj_preference_evidence_updated_at on public.dj_preference_evidence;
create trigger set_dj_preference_evidence_updated_at
  before update on public.dj_preference_evidence
  for each row execute function private.set_updated_at();

alter table public.dj_profiles enable row level security;
alter table public.dj_preference_evidence enable row level security;

drop policy if exists "dj_profiles_select_own" on public.dj_profiles;
create policy "dj_profiles_select_own"
  on public.dj_profiles for select to authenticated
  using (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

drop policy if exists "dj_profiles_insert_own" on public.dj_profiles;
create policy "dj_profiles_insert_own"
  on public.dj_profiles for insert to authenticated
  with check (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

drop policy if exists "dj_profiles_update_own" on public.dj_profiles;
create policy "dj_profiles_update_own"
  on public.dj_profiles for update to authenticated
  using (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  )
  with check (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

drop policy if exists "dj_preference_evidence_select_own" on public.dj_preference_evidence;
create policy "dj_preference_evidence_select_own"
  on public.dj_preference_evidence for select to authenticated
  using (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

drop policy if exists "dj_preference_evidence_insert_own" on public.dj_preference_evidence;
create policy "dj_preference_evidence_insert_own"
  on public.dj_preference_evidence for insert to authenticated
  with check (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

drop policy if exists "dj_preference_evidence_update_own" on public.dj_preference_evidence;
create policy "dj_preference_evidence_update_own"
  on public.dj_preference_evidence for update to authenticated
  using (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  )
  with check (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

grant select, insert, update on public.dj_profiles to authenticated;
grant select, insert, update on public.dj_preference_evidence to authenticated;

comment on table public.dj_profiles is
  'Artist-scoped Personal DJ Intelligence. Explicit preferences dominate; learned preferences may only provide bounded planner nudges.';
comment on table public.dj_preference_evidence is
  'Inspectable AutoMix feedback evidence used to evolve bounded learned DJ preferences.';
