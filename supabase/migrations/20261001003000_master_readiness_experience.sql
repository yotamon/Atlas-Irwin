-- Master Readiness Experience
-- One canonical readiness path across Track, Active Mastering and Distribution.

alter table public.track_mastering_jobs
  drop constraint if exists track_mastering_jobs_preset_check;

alter table public.track_mastering_jobs
  add constraint track_mastering_jobs_preset_check
  check (preset in ('streaming_safe', 'balanced', 'punchy', 'dynamic'));

create table if not exists public.mastering_references (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null,
  kind text not null check (kind in ('approved_master', 'uploaded_reference')),
  status text not null default 'ready' check (status in ('pending', 'queued', 'running', 'ready', 'failed')),
  track_vault_id uuid null references public.track_vault(id) on delete set null,
  media_asset_id uuid null references public.media_assets(id) on delete set null,
  audio_url text null,
  label text not null,
  reference_signature jsonb not null default '{}'::jsonb,
  source_fingerprint text null,
  analysis_state jsonb not null default '{}'::jsonb,
  external_job_id text null,
  active boolean not null default true,
  error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'approved_master' or track_vault_id is not null),
  check (status <> 'ready' or reference_signature <> '{}'::jsonb)
);

create index if not exists mastering_references_artist_idx
  on public.mastering_references(owner_id, artist_id, active, created_at desc);

create index if not exists mastering_references_pending_idx
  on public.mastering_references(status, created_at)
  where active = true and status in ('pending', 'queued', 'running');

create unique index if not exists mastering_references_approved_track_uidx
  on public.mastering_references(owner_id, artist_id, track_vault_id)
  where kind = 'approved_master' and active = true and track_vault_id is not null;

create unique index if not exists mastering_references_uploaded_asset_uidx
  on public.mastering_references(owner_id, artist_id, media_asset_id)
  where kind = 'uploaded_reference' and active = true and media_asset_id is not null;

alter table public.mastering_references enable row level security;

drop policy if exists "mastering_references_select_own" on public.mastering_references;
create policy "mastering_references_select_own"
  on public.mastering_references for select
  using (auth.uid() = owner_id);

drop policy if exists "mastering_references_insert_own" on public.mastering_references;
create policy "mastering_references_insert_own"
  on public.mastering_references for insert
  with check (auth.uid() = owner_id);

drop policy if exists "mastering_references_update_own" on public.mastering_references;
create policy "mastering_references_update_own"
  on public.mastering_references for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "mastering_references_delete_own" on public.mastering_references;
create policy "mastering_references_delete_own"
  on public.mastering_references for delete
  using (auth.uid() = owner_id);

comment on table public.mastering_references is
  'Artist-approved mastering comparison evidence. Unapproved track_vault rows never silently become mastering targets.';

-- Prefer exact catalog-track lineage when promoting vault intelligence. Compatibility
-- fallbacks may only resolve a single unambiguous title or a true one-track release.
create or replace function private.sync_vault_music_intelligence_to_track()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track_id uuid;
  v_engine text;
  v_quality text;
  v_semantic boolean;
  v_version integer;
begin
  if new.linked_track_id is null and new.linked_release_id is null then
    return new;
  end if;
  if coalesce(new.audio_profile->>'source', '') <> 'worker' then
    return new;
  end if;

  v_version := greatest(1, coalesce((new.audio_profile->>'version')::integer, 1));
  if v_version < 2 then
    return new;
  end if;

  if new.linked_track_id is not null then
    select t.id into v_track_id
    from public.tracks t
    where t.id = new.linked_track_id
      and t.owner_id = new.owner_id
      and (new.artist_id is null or t.artist_id = new.artist_id)
      and (new.linked_release_id is null or t.release_id = new.linked_release_id);
  end if;

  if v_track_id is null and new.linked_release_id is not null then
    select min(t.id::text)::uuid into v_track_id
    from public.tracks t
    where t.release_id = new.linked_release_id
      and t.owner_id = new.owner_id
      and (new.artist_id is null or t.artist_id = new.artist_id)
      and lower(btrim(t.title)) = lower(btrim(new.title))
    having count(*) = 1;
  end if;

  if v_track_id is null and new.linked_release_id is not null then
    select min(t.id::text)::uuid into v_track_id
    from public.tracks t
    where t.release_id = new.linked_release_id
      and t.owner_id = new.owner_id
      and (new.artist_id is null or t.artist_id = new.artist_id)
    having count(*) = 1;
  end if;

  if v_track_id is null then
    return new;
  end if;

  v_engine := coalesce(new.audio_profile#>>'{analysis,engine}', 'worker');
  v_quality := case when new.audio_profile#>>'{analysis,quality}' = 'fallback' then 'fallback' else 'full' end;
  v_semantic := coalesce((new.audio_profile#>>'{analysis,semantic_structure}')::boolean, false);

  insert into public.track_music_intelligence(
    track_id,
    owner_id,
    analysis_version,
    engine,
    quality,
    semantic_structure,
    analysis,
    analyzed_at
  ) values (
    v_track_id,
    new.owner_id,
    v_version,
    v_engine,
    v_quality,
    v_semantic,
    new.audio_profile,
    now()
  )
  on conflict (track_id) do update set
    owner_id = excluded.owner_id,
    analysis_version = excluded.analysis_version,
    engine = excluded.engine,
    quality = excluded.quality,
    semantic_structure = excluded.semantic_structure,
    analysis = excluded.analysis,
    analyzed_at = excluded.analyzed_at,
    updated_at = now()
  where excluded.analysis_version >= public.track_music_intelligence.analysis_version;

  return new;
end;
$$;

revoke all on function private.sync_vault_music_intelligence_to_track() from public, anon, authenticated;

comment on function private.sync_vault_music_intelligence_to_track() is
  'Synchronizes vault intelligence to the exact linked catalog track, with only unambiguous legacy fallbacks.';

