-- The canonical Track master is the selected media_links(role = 'master_audio') asset.
-- tracks.audio_url is removed entirely. Intelligence provenance may retain historical URLs, but
-- cache validity and invalidation are based only on immutable media_asset_id identity.

create or replace function private.current_track_master_asset_id(p_track_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select ml.media_asset_id
  from public.media_links ml
  where ml.track_id = p_track_id
    and ml.role = 'master_audio'
  order by ml.is_primary desc, ml.display_order asc, ml.created_at asc, ml.id asc
  limit 1
$$;

revoke all on function private.current_track_master_asset_id(uuid) from public, anon, authenticated;

create or replace function private.invalidate_track_master_dependents(
  p_track_id uuid,
  p_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release_id uuid;
begin
  if p_track_id is null or p_owner_id is null then return; end if;

  select t.release_id into v_release_id
  from public.tracks t
  where t.id = p_track_id and t.owner_id = p_owner_id;
  if v_release_id is null then return; end if;

  delete from public.track_music_intelligence
  where track_id = p_track_id and owner_id = p_owner_id;

  update public.music_video_projects p
  set music_map = '{}'::jsonb,
      analysis_completed_at = null,
      analysis_requested_at = null,
      previous_status = case when p.status = 'archived' then p.previous_status else p.status end,
      status = case when p.status = 'archived' then p.status else 'blocked'::public.music_video_project_status end,
      last_error = case
        when p.status = 'archived' then p.last_error
        else 'Track master changed. Run Track Intelligence again before continuing production.'
      end
  where p.track_id = p_track_id
    and p.owner_id = p_owner_id
    and coalesce(p.music_map->>'source', '') = 'worker';

  update public.content_items c
  set audio_timestamp_start = null,
      audio_timestamp_end = null,
      audio_timestamp_source = null,
      audio_timestamp_candidate_id = null,
      audio_timestamp_analysis_version = null
  where c.release_id = v_release_id
    and c.owner_id = p_owner_id
    and c.audio_timestamp_source = 'music_intelligence';

  update public.track_stems
  set status = 'stale',
      error = 'Canonical master changed. Re-import or explicitly rebind this stem before reuse.'
  where track_id = p_track_id and owner_id = p_owner_id;

  update public.audio_scenes
  set status = 'stale',
      preview_asset_id = null,
      preview_error = 'Canonical master changed. Regenerate this Audio Scene from current stems.'
  where track_id = p_track_id and owner_id = p_owner_id;

  update public.content_items c
  set audio_scene_id = null,
      audio_scene_source = null,
      audio_scene_reason = null
  where c.owner_id = p_owner_id
    and c.release_id = v_release_id
    and c.audio_scene_source = 'stem_intelligence';

  update public.music_video_projects
  set audio_scene_id = null
  where owner_id = p_owner_id and track_id = p_track_id;

  update public.music_video_renders r
  set audio_scene_id = null
  where r.owner_id = p_owner_id
    and exists (
      select 1
      from public.music_video_projects p
      where p.id = r.project_id
        and p.track_id = p_track_id
        and p.owner_id = p_owner_id
    );

  update public.track_stem_jobs
  set status = 'cancelled',
      error = 'Canonical master changed before this Stem Intelligence job completed.',
      completed_at = now()
  where owner_id = p_owner_id
    and track_id = p_track_id
    and status in ('planned','queued','running');

  update public.track_lyric_sections s
  set start_ms = null,
      end_ms = null,
      timing_source = null,
      music_section_id = null
  where s.owner_id = p_owner_id
    and s.timing_source in ('music_intelligence','alignment')
    and exists (
      select 1 from public.track_lyrics l
      where l.id = s.lyrics_id and l.track_id = p_track_id
    );

  update public.track_lyric_lines line
  set start_ms = null,
      end_ms = null,
      timing_source = null
  where line.owner_id = p_owner_id
    and line.timing_source in ('music_intelligence','alignment')
    and exists (
      select 1 from public.track_lyrics l
      where l.id = line.lyrics_id and l.track_id = p_track_id
    );

  update public.track_lyric_moments
  set start_ms = null,
      end_ms = null,
      timing_source = null,
      source_audio_url = null,
      music_analysis_version = null,
      updated_at = now()
  where owner_id = p_owner_id
    and track_id = p_track_id
    and timing_source in ('music_intelligence','alignment');
end;
$$;

revoke all on function private.invalidate_track_master_dependents(uuid, uuid)
  from public, anon, authenticated;

-- One canonical master-change event fans out to every dependent intelligence subsystem.
create or replace function private.invalidate_track_master_from_media_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT'
     and old.role = 'master_audio'
     and old.track_id is not null then
    perform private.invalidate_track_master_dependents(old.track_id, old.owner_id);
  end if;

  if tg_op <> 'DELETE'
     and new.role = 'master_audio'
     and new.track_id is not null
     and (
       tg_op = 'INSERT'
       or old.role is distinct from new.role
       or old.track_id is distinct from new.track_id
       or old.media_asset_id is distinct from new.media_asset_id
       or old.is_primary is distinct from new.is_primary
       or old.display_order is distinct from new.display_order
     ) then
    if tg_op = 'INSERT'
       or old.track_id is distinct from new.track_id
       or old.owner_id is distinct from new.owner_id then
      perform private.invalidate_track_master_dependents(new.track_id, new.owner_id);
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function private.invalidate_track_master_from_media_link()
  from public, anon, authenticated;

drop trigger if exists invalidate_track_master_dependents on public.media_links;
create trigger invalidate_track_master_dependents
  after insert or update of role, track_id, media_asset_id, is_primary, display_order or delete
  on public.media_links
  for each row execute function private.invalidate_track_master_from_media_link();

-- Stems bind to the immutable canonical master asset, never to a duplicated Track URL.
create or replace function private.validate_track_stem()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_track_owner uuid;
  v_master_asset_id uuid;
  v_asset_owner uuid;
  v_asset_type text;
begin
  select t.owner_id into v_track_owner
  from public.tracks t where t.id = new.track_id;
  if v_track_owner is null then raise exception 'Stem track must exist'; end if;
  if v_track_owner <> new.owner_id then raise exception 'Stem owner must match track owner'; end if;

  v_master_asset_id := private.current_track_master_asset_id(new.track_id);
  if v_master_asset_id is null then
    raise exception 'Attach a canonical master_audio asset before importing stems';
  end if;
  if new.source_master_media_asset_id is distinct from v_master_asset_id then
    raise exception 'Stem must be bound to the current canonical master asset';
  end if;

  select a.owner_id, a.asset_type::text into v_asset_owner, v_asset_type
  from public.media_assets a where a.id = new.media_asset_id;
  if v_asset_owner is null then raise exception 'Stem media asset must exist'; end if;
  if v_asset_owner <> new.owner_id then raise exception 'Stem media asset owner must match track owner'; end if;
  if v_asset_type <> 'stem' then raise exception 'Stem media asset must use the stem asset type'; end if;
  return new;
end;
$$;

-- Worker results are canonical only when their immutable source asset is the current master.
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
  v_current_master_asset_id uuid;
  v_audio_sha256 text;
  v_analysis_config text;
  v_downbeat_source text;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if coalesce(new.music_map->>'source', '') <> 'worker' then return new; end if;

  v_version := greatest(1, coalesce((new.music_map->>'version')::integer, 1));
  if v_version < 3 then return new; end if;

  v_current_master_asset_id := private.current_track_master_asset_id(new.track_id);
  begin
    v_source_media_asset_id := nullif(new.music_map#>>'{source_audio,media_asset_id}', '')::uuid;
  exception when invalid_text_representation then
    v_source_media_asset_id := null;
  end;
  if v_current_master_asset_id is null
     or v_source_media_asset_id is distinct from v_current_master_asset_id then
    return new;
  end if;

  v_source_url := nullif(new.music_map#>>'{source_audio,url}', '');
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
    track_id, owner_id, artist_id, analysis_version, engine, quality, semantic_structure,
    source_audio_url, source_media_asset_id, audio_sha256, analysis_config,
    downbeat_source, analysis, analyzed_at
  ) values (
    new.track_id, new.owner_id, new.artist_id, v_version, v_engine, v_quality, v_semantic,
    v_source_url, v_source_media_asset_id, v_audio_sha256, v_analysis_config,
    v_downbeat_source, new.music_map, coalesce(new.analysis_completed_at, now())
  )
  on conflict (track_id) do update set
    owner_id = excluded.owner_id,
    artist_id = excluded.artist_id,
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
     or excluded.source_media_asset_id is distinct from public.track_music_intelligence.source_media_asset_id;

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
    and p.artist_id = new.artist_id
    and p.track_id = new.track_id
    and p.id <> new.id
    and (
      coalesce(p.music_map->>'source', '') <> 'worker'
      or coalesce((p.music_map->>'version')::integer, 1) < v_version
      or p.music_map#>>'{source_audio,media_asset_id}' is distinct from v_source_media_asset_id::text
    );

  return new;
end;
$$;

create or replace function private.reuse_track_music_intelligence_for_worker_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track_id uuid;
  v_master_asset_id uuid;
  v_analysis jsonb;
begin
  if new.job_type <> 'analyze_audio' or new.status <> 'planned' then return new; end if;

  select p.track_id into v_track_id
  from public.music_video_projects p
  where p.id = new.project_id and p.owner_id = new.owner_id;

  v_master_asset_id := private.current_track_master_asset_id(v_track_id);
  if v_master_asset_id is null then return new; end if;

  select i.analysis into v_analysis
  from public.track_music_intelligence i
  where i.track_id = v_track_id
    and i.owner_id = new.owner_id
    and i.analysis_version >= 3
    and i.source_media_asset_id = v_master_asset_id
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

create or replace function private.prefer_canonical_track_music_intelligence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_analysis jsonb;
  v_master_asset_id uuid;
  v_map_asset_id uuid;
begin
  v_master_asset_id := private.current_track_master_asset_id(new.track_id);
  if v_master_asset_id is null then return new; end if;

  begin
    v_map_asset_id := nullif(new.music_map#>>'{source_audio,media_asset_id}', '')::uuid;
  exception when invalid_text_representation then
    v_map_asset_id := null;
  end;

  if coalesce(new.music_map->>'source', '') = 'worker'
     and coalesce((new.music_map->>'version')::integer, 1) >= 3
     and v_map_asset_id = v_master_asset_id then
    return new;
  end if;

  select i.analysis into v_analysis
  from public.track_music_intelligence i
  where i.track_id = new.track_id
    and i.owner_id = new.owner_id
    and i.analysis_version >= 3
    and i.source_media_asset_id = v_master_asset_id
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

-- Remove all column-bound legacy invalidation triggers before dropping tracks.audio_url.
drop trigger if exists invalidate_stem_intelligence_on_audio_change on public.tracks;
drop trigger if exists invalidate_lyric_timing_on_audio_change on public.tracks;
drop trigger if exists invalidate_track_music_intelligence_on_audio_change on public.tracks;

drop function if exists private.invalidate_stem_intelligence_on_audio_change();
drop function if exists private.invalidate_lyric_timing_on_audio_change();
drop function if exists private.invalidate_track_music_intelligence_on_audio_change();

alter table public.tracks drop column if exists audio_url;
