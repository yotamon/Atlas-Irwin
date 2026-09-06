-- Automatic content timing must be derived only from Track Intelligence that belongs to the
-- Track's current immutable master asset. Source URLs remain provenance only.

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
    and i.source_media_asset_id is not null
    and i.source_media_asset_id = private.current_track_master_asset_id(t.id)
    and coalesce(i.analysis->>'source', '') = 'worker'
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

revoke all on function private.music_intelligence_cut_for_content(uuid,text,text)
  from public, anon, authenticated;

-- refresh_track_moments uses pgcrypto digest() for immutable fingerprints. The preceding
-- canonical redefinition intentionally keeps all relation/function references schema-qualified,
-- so the trusted extensions schema can be exposed without putting public on a SECURITY DEFINER
-- search path.
alter function private.refresh_track_moments(uuid)
  set search_path = 'extensions', 'pg_catalog';