-- Atlas Music Intelligence v2
-- Persist one canonical analysis per track, reuse it across Video Director and Marketing,
-- and automatically attach the best short-form audio window to draft content.

create table public.track_music_intelligence (
  track_id uuid primary key references public.tracks(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  analysis_version integer not null default 2 check (analysis_version > 0),
  engine text not null,
  quality text not null default 'full' check (quality in ('full','fallback')),
  semantic_structure boolean not null default false,
  analysis jsonb not null default '{}'::jsonb,
  analyzed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(analysis) = 'object')
);

create index track_music_intelligence_owner_idx
  on public.track_music_intelligence(owner_id, analyzed_at desc);

alter table public.track_music_intelligence enable row level security;

create policy "admins select own track_music_intelligence"
  on public.track_music_intelligence for select to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins insert own track_music_intelligence"
  on public.track_music_intelligence for insert to authenticated
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins update own track_music_intelligence"
  on public.track_music_intelligence for update to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins delete own track_music_intelligence"
  on public.track_music_intelligence for delete to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin());

create trigger set_track_music_intelligence_updated_at
  before update on public.track_music_intelligence
  for each row execute function private.set_updated_at();

-- Persist every real worker result as the canonical track analysis. Estimated maps are
-- intentionally excluded so a fallback can never overwrite a real analysis.
create or replace function private.sync_track_music_intelligence_from_video_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_engine text;
  v_quality text;
  v_semantic boolean;
  v_version integer;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if coalesce(new.music_map->>'source', '') <> 'worker' then
    return new;
  end if;
  v_version := greatest(1, coalesce((new.music_map->>'version')::integer, 1));
  v_engine := coalesce(new.music_map#>>'{analysis,engine}', 'worker');
  v_quality := case when new.music_map#>>'{analysis,quality}' = 'fallback' then 'fallback' else 'full' end;
  v_semantic := coalesce((new.music_map#>>'{analysis,semantic_structure}')::boolean, false);

  insert into public.track_music_intelligence(
    track_id, owner_id, analysis_version, engine, quality,
    semantic_structure, analysis, analyzed_at
  ) values (
    new.track_id, new.owner_id, v_version, v_engine, v_quality,
    v_semantic, new.music_map, coalesce(new.analysis_completed_at, now())
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

  -- Keep projects that have no real analysis in sync with the canonical track result.
  update public.music_video_projects p
  set music_map = new.music_map,
      analysis_completed_at = coalesce(new.analysis_completed_at, now()),
      last_error = case when p.status = 'blocked' and p.previous_status = 'analyzing_audio' then null else p.last_error end,
      status = case
        when p.status in ('draft','analyzing_audio','blocked') then 'concept_review'::public.music_video_project_status
        else p.status
      end,
      previous_status = case when p.status in ('draft','analyzing_audio','blocked') then null else p.previous_status end
  where p.owner_id = new.owner_id
    and p.track_id = new.track_id
    and p.id <> new.id
    and coalesce(p.music_map->>'source', '') <> 'worker';

  return new;
end;
$$;

revoke all on function private.sync_track_music_intelligence_from_video_project() from public, anon, authenticated;

create trigger sync_track_music_intelligence_from_video_project
  after insert or update of music_map on public.music_video_projects
  for each row execute function private.sync_track_music_intelligence_from_video_project();

-- A queued analysis job becomes an immediate completed cache hit when the same track already
-- has a v2 worker result. queueMediaWorkerJob checks the returned status before dispatch.
create or replace function private.reuse_track_music_intelligence_for_worker_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track_id uuid;
  v_analysis jsonb;
begin
  if new.job_type <> 'analyze_audio' or new.status <> 'planned' then
    return new;
  end if;

  select p.track_id into v_track_id
  from public.music_video_projects p
  where p.id = new.project_id and p.owner_id = new.owner_id;

  select i.analysis into v_analysis
  from public.track_music_intelligence i
  where i.track_id = v_track_id
    and i.owner_id = new.owner_id
    and i.analysis_version >= 2
    and coalesce(i.analysis->>'source', '') = 'worker';

  if v_analysis is null then
    return new;
  end if;

  update public.music_video_projects
  set music_map = v_analysis,
      status = 'concept_review',
      previous_status = null,
      last_error = null,
      analysis_completed_at = now()
  where id = new.project_id and owner_id = new.owner_id;

  new.status := 'completed';
  new.result_payload := jsonb_build_object('music_map', v_analysis, 'cache_hit', true);
  new.error := null;
  new.started_at := now();
  new.completed_at := now();
  return new;
end;
$$;

revoke all on function private.reuse_track_music_intelligence_for_worker_job() from public, anon, authenticated;

create trigger reuse_track_music_intelligence_for_worker_job
  before insert on public.music_video_worker_jobs
  for each row execute function private.reuse_track_music_intelligence_for_worker_job();

-- Select a social cut for a release. Content Lab stores integer seconds while Music
-- Intelligence uses milliseconds, so conversion is deliberately centralized here.
create or replace function private.music_intelligence_cut_for_content(
  p_release_id uuid,
  p_format text,
  p_platform text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_analysis jsonb;
  v_key text;
begin
  select i.analysis into v_analysis
  from public.tracks t
  join public.track_music_intelligence i on i.track_id = t.id
  where t.release_id = p_release_id
  order by t.is_primary desc, t.created_at asc
  limit 1;

  if v_analysis is null then
    return null;
  end if;

  v_key := case
    when lower(coalesce(p_format, '')) like '%30%' then '30'
    when lower(coalesce(p_format, '')) like '%8%' then '8'
    when lower(coalesce(p_format, '')) like '%6%' then '6'
    when lower(coalesce(p_platform, '')) in ('instagram','tiktok','youtube shorts') then '15'
    else '15'
  end;

  return v_analysis->'social_cuts'->v_key;
end;
$$;

revoke all on function private.music_intelligence_cut_for_content(uuid,text,text) from public, anon, authenticated;

create or replace function private.apply_music_intelligence_to_content_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cut jsonb;
begin
  if new.release_id is null then
    return new;
  end if;
  if new.audio_timestamp_start is not null and new.audio_timestamp_end is not null then
    return new;
  end if;

  v_cut := private.music_intelligence_cut_for_content(
    new.release_id,
    new.format,
    new.platform::text
  );
  if v_cut is null then
    return new;
  end if;

  if new.audio_timestamp_start is null then
    new.audio_timestamp_start := floor(coalesce((v_cut->>'start_ms')::numeric, 0) / 1000.0)::integer;
  end if;
  if new.audio_timestamp_end is null then
    new.audio_timestamp_end := ceil(coalesce((v_cut->>'end_ms')::numeric, 0) / 1000.0)::integer;
  end if;
  return new;
end;
$$;

revoke all on function private.apply_music_intelligence_to_content_item() from public, anon, authenticated;

create trigger apply_music_intelligence_to_content_item
  before insert or update of release_id, format, platform, audio_timestamp_start, audio_timestamp_end
  on public.content_items
  for each row execute function private.apply_music_intelligence_to_content_item();

-- When a track is analyzed after campaign drafts already exist, fill only missing audio
-- windows. User-edited timestamps are never overwritten.
create or replace function private.backfill_content_from_track_music_intelligence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release_id uuid;
begin
  select t.release_id into v_release_id
  from public.tracks t
  where t.id = new.track_id;

  update public.content_items c
  set audio_timestamp_start = coalesce(
        c.audio_timestamp_start,
        floor(coalesce((private.music_intelligence_cut_for_content(c.release_id, c.format, c.platform::text)->>'start_ms')::numeric, 0) / 1000.0)::integer
      ),
      audio_timestamp_end = coalesce(
        c.audio_timestamp_end,
        ceil(coalesce((private.music_intelligence_cut_for_content(c.release_id, c.format, c.platform::text)->>'end_ms')::numeric, 0) / 1000.0)::integer
      )
  where c.owner_id = new.owner_id
    and c.release_id = v_release_id
    and c.status in ('Idea','Draft','In Production','Ready')
    and (c.audio_timestamp_start is null or c.audio_timestamp_end is null)
    and private.music_intelligence_cut_for_content(c.release_id, c.format, c.platform::text) is not null;

  return new;
end;
$$;

revoke all on function private.backfill_content_from_track_music_intelligence() from public, anon, authenticated;

create trigger backfill_content_from_track_music_intelligence
  after insert or update of analysis on public.track_music_intelligence
  for each row execute function private.backfill_content_from_track_music_intelligence();

-- Backfill canonical intelligence from already-completed real worker maps. Older v1 maps are
-- retained for visibility but will be reanalyzed on the next request because cache reuse is v2+.
insert into public.track_music_intelligence(
  track_id, owner_id, analysis_version, engine, quality,
  semantic_structure, analysis, analyzed_at
)
select distinct on (p.track_id)
  p.track_id,
  p.owner_id,
  greatest(1, coalesce((p.music_map->>'version')::integer, 1)),
  coalesce(p.music_map#>>'{analysis,engine}', 'legacy-worker'),
  case when p.music_map#>>'{analysis,quality}' = 'fallback' then 'fallback' else 'full' end,
  coalesce((p.music_map#>>'{analysis,semantic_structure}')::boolean, false),
  p.music_map,
  coalesce(p.analysis_completed_at, p.updated_at)
from public.music_video_projects p
where coalesce(p.music_map->>'source', '') = 'worker'
order by p.track_id, coalesce(p.analysis_completed_at, p.updated_at) desc
on conflict (track_id) do nothing;

grant select, insert, update, delete on public.track_music_intelligence to authenticated;
