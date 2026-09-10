-- Track Intelligence v3 hardening.
-- Only exact-master v3 results may drive automatic media timing. Existing timestamps whose
-- origin cannot be proven are preserved as manual rather than being destructively invalidated.

create index if not exists track_vault_analysis_queue_idx
  on public.track_vault ((analysis->>'status'), updated_at)
  where analysis->>'status' in ('queued','dispatched','running');

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
    and i.analysis_version >= 3
    and i.source_audio_url is not distinct from t.audio_url
    and coalesce(i.analysis->>'source', '') = 'worker'
  order by t.is_primary desc, t.created_at asc
  limit 1;

  if v_analysis is null then return null; end if;

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

-- Identify only timestamps that exactly match a currently valid v3 automatic cut. Everything
-- else is treated as user-owned/manual so master replacement cannot erase intentional edits.
with inferred as (
  select
    c.id,
    i.analysis_version,
    private.music_intelligence_cut_for_content(c.release_id, c.format, c.platform::text) as cut
  from public.content_items c
  join public.tracks t on t.release_id = c.release_id and t.is_primary
  join public.track_music_intelligence i on i.track_id = t.id
  where c.audio_timestamp_source is null
    and c.audio_timestamp_start is not null
    and c.audio_timestamp_end is not null
    and i.analysis_version >= 3
    and i.source_audio_url is not distinct from t.audio_url
), matched as (
  select * from inferred
  where cut is not null
    and floor(coalesce((cut->>'start_ms')::numeric, 0) / 1000.0)::integer = (
      select c.audio_timestamp_start from public.content_items c where c.id = inferred.id
    )
    and ceil(coalesce((cut->>'end_ms')::numeric, 0) / 1000.0)::integer = (
      select c.audio_timestamp_end from public.content_items c where c.id = inferred.id
    )
)
update public.content_items c
set audio_timestamp_source = 'music_intelligence',
    audio_timestamp_candidate_id = matched.cut->>'candidate_id',
    audio_timestamp_analysis_version = matched.analysis_version
from matched
where c.id = matched.id;

update public.content_items
set audio_timestamp_source = 'manual'
where audio_timestamp_source is null
  and audio_timestamp_start is not null
  and audio_timestamp_end is not null;

-- Re-define the Vault bridge with one additional invariant: the canonical release track itself
-- must still point at the exact URL that produced the analysis.
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
  where t.owner_id = new.owner_id
    and t.release_id = new.linked_release_id
    and t.audio_url is not distinct from v_source_url
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
