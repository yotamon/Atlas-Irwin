-- Atlas Track Intelligence v3
-- Bind every automatic decision to the exact master, preserve provenance, invalidate stale
-- timings when a master changes, and upgrade the canonical cache contract to v3.

alter table public.track_music_intelligence
  add column if not exists source_audio_url text,
  add column if not exists source_media_asset_id uuid references public.media_assets(id) on delete set null,
  add column if not exists audio_sha256 text,
  add column if not exists analysis_config text,
  add column if not exists downbeat_source text not null default 'none'
    check (downbeat_source in ('model','inferred_from_beats','synthetic_grid','none'));

create index if not exists track_music_intelligence_source_asset_idx
  on public.track_music_intelligence(source_media_asset_id)
  where source_media_asset_id is not null;
create index if not exists track_music_intelligence_audio_sha_idx
  on public.track_music_intelligence(audio_sha256)
  where audio_sha256 is not null;

alter table public.content_items
  add column if not exists audio_timestamp_source text
    check (audio_timestamp_source in ('manual','music_intelligence')),
  add column if not exists audio_timestamp_candidate_id text,
  add column if not exists audio_timestamp_analysis_version integer
    check (audio_timestamp_analysis_version is null or audio_timestamp_analysis_version > 0);

update public.track_music_intelligence
set source_audio_url = nullif(analysis#>>'{source_audio,url}', ''),
    audio_sha256 = nullif(analysis#>>'{source_audio,audio_sha256}', ''),
    analysis_config = nullif(analysis#>>'{analysis,config}', ''),
    downbeat_source = case
      when analysis#>>'{analysis,downbeat_source}' in ('model','inferred_from_beats','synthetic_grid','none')
        then analysis#>>'{analysis,downbeat_source}'
      when coalesce((analysis#>>'{analysis,real_downbeats}')::boolean, false) then 'model'
      else 'none'
    end
where source_audio_url is null
   or audio_sha256 is null
   or analysis_config is null
   or downbeat_source = 'none';

-- A worker map is canonical only when it identifies the same master currently attached to
-- the track. This prevents a valid-looking map from an older master surviving replacement.
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
  v_source_url text;
  v_source_media_asset_id uuid;
  v_audio_sha256 text;
  v_analysis_config text;
  v_downbeat_source text;
  v_track_audio_url text;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if coalesce(new.music_map->>'source', '') <> 'worker' then return new; end if;

  v_version := greatest(1, coalesce((new.music_map->>'version')::integer, 1));
  if v_version < 3 then return new; end if;

  select t.audio_url into v_track_audio_url
  from public.tracks t
  where t.id = new.track_id and t.owner_id = new.owner_id;

  v_source_url := nullif(new.music_map#>>'{source_audio,url}', '');
  if v_source_url is null or v_track_audio_url is distinct from v_source_url then
    return new;
  end if;

  begin
    v_source_media_asset_id := nullif(new.music_map#>>'{source_audio,media_asset_id}', '')::uuid;
  exception when invalid_text_representation then
    v_source_media_asset_id := null;
  end;
  v_audio_sha256 := nullif(new.music_map#>>'{source_audio,audio_sha256}', '');
  v_analysis_config := nullif(new.music_map#>>'{analysis,config}', '');
  v_engine := coalesce(new.music_map#>>'{analysis,engine}', 'worker');
  v_quality := case when new.music_map#>>'{analysis,quality}' = 'fallback' then 'fallback' else 'full' end;
  v_semantic := coalesce((new.music_map#>>'{analysis,semantic_structure}')::boolean, false);
  v_downbeat_source := case
    when new.music_map#>>'{analysis,downbeat_source}' in ('model','inferred_from_beats','synthetic_grid','none')
      then new.music_map#>>'{analysis,downbeat_source}'
    else 'none'
  end;

  insert into public.track_music_intelligence(
    track_id, owner_id, analysis_version, engine, quality, semantic_structure,
    source_audio_url, source_media_asset_id, audio_sha256, analysis_config,
    downbeat_source, analysis, analyzed_at
  ) values (
    new.track_id, new.owner_id, v_version, v_engine, v_quality, v_semantic,
    v_source_url, v_source_media_asset_id, v_audio_sha256, v_analysis_config,
    v_downbeat_source, new.music_map, coalesce(new.analysis_completed_at, now())
  )
  on conflict (track_id) do update set
    owner_id = excluded.owner_id,
    analysis_version = excluded.analysis_version,
    engine = excluded.engine,
    quality = excluded.quality,
    semantic_structure = excluded.semantic_structure,
    source_audio_url = excluded.source_audio_url,
    source_media_asset_id = excluded.source_media_asset_id,
    audio_sha256 = excluded.audio_sha256,
    analysis_config = excluded.analysis_config,
    downbeat_source = excluded.downbeat_source,
    analysis = excluded.analysis,
    analyzed_at = excluded.analyzed_at,
    updated_at = now()
  where excluded.analysis_version >= public.track_music_intelligence.analysis_version
     or excluded.source_audio_url is distinct from public.track_music_intelligence.source_audio_url;

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
    and exists (
      select 1 from public.tracks t
      where t.id = p.track_id and t.audio_url is not distinct from v_source_url
    )
    and (
      coalesce(p.music_map->>'source', '') <> 'worker'
      or coalesce((p.music_map->>'version')::integer, 1) < v_version
      or p.music_map#>>'{source_audio,url}' is distinct from v_source_url
    );

  return new;
end;
$$;

revoke all on function private.sync_track_music_intelligence_from_video_project() from public, anon, authenticated;

-- Cache hits must match both schema generation and source master.
create or replace function private.reuse_track_music_intelligence_for_worker_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track_id uuid;
  v_track_audio_url text;
  v_analysis jsonb;
begin
  if new.job_type <> 'analyze_audio' or new.status <> 'planned' then return new; end if;

  select p.track_id, t.audio_url into v_track_id, v_track_audio_url
  from public.music_video_projects p
  join public.tracks t on t.id = p.track_id
  where p.id = new.project_id and p.owner_id = new.owner_id;

  select i.analysis into v_analysis
  from public.track_music_intelligence i
  where i.track_id = v_track_id
    and i.owner_id = new.owner_id
    and i.analysis_version >= 3
    and i.source_audio_url is not distinct from v_track_audio_url
    and coalesce(i.analysis->>'source', '') = 'worker'
  order by i.analysis_version desc, i.analyzed_at desc
  limit 1;

  if v_analysis is null then return new; end if;

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

create or replace function private.prefer_canonical_track_music_intelligence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_analysis jsonb;
  v_track_audio_url text;
begin
  select t.audio_url into v_track_audio_url
  from public.tracks t
  where t.id = new.track_id and t.owner_id = new.owner_id;

  if coalesce(new.music_map->>'source', '') = 'worker'
     and coalesce((new.music_map->>'version')::integer, 1) >= 3
     and new.music_map#>>'{source_audio,url}' is not distinct from v_track_audio_url then
    return new;
  end if;

  select i.analysis into v_analysis
  from public.track_music_intelligence i
  where i.track_id = new.track_id
    and i.owner_id = new.owner_id
    and i.analysis_version >= 3
    and i.source_audio_url is not distinct from v_track_audio_url
    and coalesce(i.analysis->>'source', '') = 'worker'
  order by i.analysis_version desc, i.analyzed_at desc
  limit 1;

  if v_analysis is null then return new; end if;

  new.music_map := v_analysis;
  new.analysis_completed_at := coalesce(new.analysis_completed_at, now());
  new.last_error := null;
  if new.status in ('draft','analyzing_audio','blocked') then
    new.status := 'concept_review';
    new.previous_status := null;
  end if;
  return new;
end;
$$;

revoke all on function private.prefer_canonical_track_music_intelligence() from public, anon, authenticated;

-- The Vault is allowed to promote a v3 result only when the worker analyzed the Vault entry's
-- current master. media_asset_id is strongest; URL equality is the compatibility fallback.
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
  v_source_url text;
  v_source_media_asset_id uuid;
  v_audio_sha256 text;
  v_analysis_config text;
  v_downbeat_source text;
begin
  if new.linked_release_id is null then return new; end if;
  if coalesce(new.audio_profile->>'source', '') <> 'worker' then return new; end if;
  v_version := greatest(1, coalesce((new.audio_profile->>'version')::integer, 1));
  if v_version < 3 then return new; end if;

  v_source_url := nullif(new.audio_profile#>>'{source_audio,url}', '');
  begin
    v_source_media_asset_id := nullif(new.audio_profile#>>'{source_audio,media_asset_id}', '')::uuid;
  exception when invalid_text_representation then
    v_source_media_asset_id := null;
  end;
  if v_source_media_asset_id is not null then
    if new.media_asset_id is distinct from v_source_media_asset_id then return new; end if;
  elsif v_source_url is null or new.audio_url is distinct from v_source_url then
    return new;
  end if;

  select t.id into v_track_id
  from public.tracks t
  where t.owner_id = new.owner_id and t.release_id = new.linked_release_id
  order by (lower(t.title) = lower(new.title)) desc, t.is_primary desc, t.created_at asc
  limit 1;
  if v_track_id is null then return new; end if;

  v_engine := coalesce(new.audio_profile#>>'{analysis,engine}', 'worker');
  v_quality := case when new.audio_profile#>>'{analysis,quality}' = 'fallback' then 'fallback' else 'full' end;
  v_semantic := coalesce((new.audio_profile#>>'{analysis,semantic_structure}')::boolean, false);
  v_audio_sha256 := nullif(new.audio_profile#>>'{source_audio,audio_sha256}', '');
  v_analysis_config := nullif(new.audio_profile#>>'{analysis,config}', '');
  v_downbeat_source := case
    when new.audio_profile#>>'{analysis,downbeat_source}' in ('model','inferred_from_beats','synthetic_grid','none')
      then new.audio_profile#>>'{analysis,downbeat_source}'
    else 'none'
  end;

  insert into public.track_music_intelligence(
    track_id, owner_id, analysis_version, engine, quality, semantic_structure,
    source_audio_url, source_media_asset_id, audio_sha256, analysis_config,
    downbeat_source, analysis, analyzed_at
  ) values (
    v_track_id, new.owner_id, v_version, v_engine, v_quality, v_semantic,
    v_source_url, new.media_asset_id, v_audio_sha256, v_analysis_config,
    v_downbeat_source, new.audio_profile, now()
  )
  on conflict (track_id) do update set
    owner_id = excluded.owner_id,
    analysis_version = excluded.analysis_version,
    engine = excluded.engine,
    quality = excluded.quality,
    semantic_structure = excluded.semantic_structure,
    source_audio_url = excluded.source_audio_url,
    source_media_asset_id = excluded.source_media_asset_id,
    audio_sha256 = excluded.audio_sha256,
    analysis_config = excluded.analysis_config,
    downbeat_source = excluded.downbeat_source,
    analysis = excluded.analysis,
    analyzed_at = excluded.analyzed_at,
    updated_at = now()
  where excluded.analysis_version >= public.track_music_intelligence.analysis_version
     or excluded.source_audio_url is distinct from public.track_music_intelligence.source_audio_url;
  return new;
end;
$$;

revoke all on function private.sync_vault_music_intelligence_to_track() from public, anon, authenticated;

-- Track master replacement invalidates every automatic timestamp derived from the previous
-- master. Manual timestamps are intentionally preserved.
create or replace function private.invalidate_track_music_intelligence_on_audio_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.audio_url is not distinct from new.audio_url then return new; end if;

  delete from public.track_music_intelligence
  where track_id = new.id and owner_id = new.owner_id;

  update public.music_video_projects p
  set music_map = '{}'::jsonb,
      analysis_completed_at = null,
      analysis_requested_at = null,
      previous_status = case when p.status = 'archived' then p.previous_status else p.status end,
      status = case when p.status = 'archived' then p.status else 'blocked'::public.music_video_project_status end,
      last_error = case when p.status = 'archived' then p.last_error else 'Track master changed. Run Track Intelligence again before continuing production.' end
  where p.track_id = new.id
    and p.owner_id = new.owner_id
    and coalesce(p.music_map->>'source', '') = 'worker';

  update public.content_items c
  set audio_timestamp_start = null,
      audio_timestamp_end = null,
      audio_timestamp_source = null,
      audio_timestamp_candidate_id = null,
      audio_timestamp_analysis_version = null
  where c.release_id = new.release_id
    and c.owner_id = new.owner_id
    and c.audio_timestamp_source = 'music_intelligence';

  return new;
end;
$$;

revoke all on function private.invalidate_track_music_intelligence_on_audio_change() from public, anon, authenticated;

drop trigger if exists invalidate_track_music_intelligence_on_audio_change on public.tracks;
create trigger invalidate_track_music_intelligence_on_audio_change
  after update of audio_url on public.tracks
  for each row execute function private.invalidate_track_music_intelligence_on_audio_change();

-- Timestamp provenance makes future invalidation safe: Atlas can clear only its own decisions.
create or replace function private.apply_music_intelligence_to_content_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cut jsonb;
  v_version integer;
begin
  if new.release_id is null then return new; end if;
  if new.audio_timestamp_start is not null and new.audio_timestamp_end is not null then
    if new.audio_timestamp_source is null then
      new.audio_timestamp_source := 'manual';
    end if;
    return new;
  end if;

  v_cut := private.music_intelligence_cut_for_content(new.release_id, new.format, new.platform::text);
  if v_cut is null then return new; end if;

  select i.analysis_version into v_version
  from public.tracks t
  join public.track_music_intelligence i on i.track_id = t.id
  where t.release_id = new.release_id
  order by t.is_primary desc, t.created_at asc
  limit 1;

  if new.audio_timestamp_start is null then
    new.audio_timestamp_start := floor(coalesce((v_cut->>'start_ms')::numeric, 0) / 1000.0)::integer;
  end if;
  if new.audio_timestamp_end is null then
    new.audio_timestamp_end := ceil(coalesce((v_cut->>'end_ms')::numeric, 0) / 1000.0)::integer;
  end if;
  new.audio_timestamp_source := 'music_intelligence';
  new.audio_timestamp_candidate_id := v_cut->>'candidate_id';
  new.audio_timestamp_analysis_version := v_version;
  return new;
end;
$$;

revoke all on function private.apply_music_intelligence_to_content_item() from public, anon, authenticated;

create or replace function private.backfill_content_from_track_music_intelligence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release_id uuid;
begin
  select t.release_id into v_release_id from public.tracks t where t.id = new.track_id;

  update public.content_items c
  set audio_timestamp_start = coalesce(
        c.audio_timestamp_start,
        floor(coalesce((private.music_intelligence_cut_for_content(c.release_id, c.format, c.platform::text)->>'start_ms')::numeric, 0) / 1000.0)::integer
      ),
      audio_timestamp_end = coalesce(
        c.audio_timestamp_end,
        ceil(coalesce((private.music_intelligence_cut_for_content(c.release_id, c.format, c.platform::text)->>'end_ms')::numeric, 0) / 1000.0)::integer
      ),
      audio_timestamp_source = case
        when c.audio_timestamp_start is null or c.audio_timestamp_end is null then 'music_intelligence'
        else c.audio_timestamp_source
      end,
      audio_timestamp_candidate_id = case
        when c.audio_timestamp_start is null or c.audio_timestamp_end is null
          then private.music_intelligence_cut_for_content(c.release_id, c.format, c.platform::text)->>'candidate_id'
        else c.audio_timestamp_candidate_id
      end,
      audio_timestamp_analysis_version = case
        when c.audio_timestamp_start is null or c.audio_timestamp_end is null then new.analysis_version
        else c.audio_timestamp_analysis_version
      end
  where c.owner_id = new.owner_id
    and c.release_id = v_release_id
    and c.status in ('Idea','Draft','In Production','Ready')
    and (c.audio_timestamp_start is null or c.audio_timestamp_end is null)
    and private.music_intelligence_cut_for_content(c.release_id, c.format, c.platform::text) is not null;

  return new;
end;
$$;

revoke all on function private.backfill_content_from_track_music_intelligence() from public, anon, authenticated;

-- Completed pre-v3 jobs must not satisfy the old idempotency key during the first upgrade.
update public.music_video_worker_jobs j
set idempotency_key = 'legacy-pre-v3:' || j.id::text || ':' || j.idempotency_key,
    updated_at = now()
where j.job_type = 'analyze_audio'
  and j.status = 'completed'
  and coalesce((j.result_payload#>>'{music_map,version}')::integer, 1) < 3
  and j.idempotency_key not like 'legacy-pre-v3:%';
