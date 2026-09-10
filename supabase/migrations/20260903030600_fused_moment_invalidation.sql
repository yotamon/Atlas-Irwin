-- Fused Moments are durable only while every referenced evidence class is still current.

create or replace function private.supersede_stale_fused_moments(p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.moments m
  set state = 'superseded', updated_at = now()
  where m.track_id = p_track_id
    and m.source_mode = 'fused'
    and m.state in ('proposed','approved')
    and (
      (m.source_candidate_id is not null and not exists (
        select 1
        from public.tracks t
        join public.track_music_intelligence i on i.track_id = t.id
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(i.analysis->'hook_candidates') = 'array'
            then i.analysis->'hook_candidates' else '[]'::jsonb end
        ) candidate
        where t.id = m.track_id
          and i.analysis_version = m.track_analysis_version
          and i.source_audio_url is not distinct from t.audio_url
          and candidate->>'id' = m.source_candidate_id
          and (m.track_analysis_audio_sha256 is null or i.audio_sha256 is not distinct from m.track_analysis_audio_sha256)
      ))
      or (m.lyric_moment_id is not null and not exists (
        select 1 from public.track_lyric_moments lm
        where lm.id = m.lyric_moment_id
          and lm.track_id = m.track_id
          and lm.lyrics_version = m.lyrics_version
          and lm.start_ms is not null and lm.end_ms is not null and lm.end_ms > lm.start_ms
      ))
      or (m.audio_scene_id is not null and not exists (
        select 1 from public.audio_scenes s
        where s.id = m.audio_scene_id
          and s.track_id = m.track_id
          and s.recipe_version = m.audio_scene_recipe_version
          and s.status = 'ready'
          and s.recommended_start_ms is not null
          and s.recommended_end_ms is not null
          and s.recommended_end_ms > s.recommended_start_ms
      ))
    );
end;
$$;
revoke all on function private.supersede_stale_fused_moments(uuid) from public, anon, authenticated;

create or replace function private.supersede_fused_after_source_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track_id uuid;
begin
  v_track_id := case when tg_op = 'DELETE' then old.track_id else new.track_id end;
  perform private.supersede_stale_fused_moments(v_track_id);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.supersede_fused_after_source_change() from public, anon, authenticated;

create trigger zz_supersede_stale_fused_from_track_intelligence
  after insert or update or delete on public.track_music_intelligence for each row
  execute function private.supersede_fused_after_source_change();
create trigger zz_supersede_stale_fused_from_lyric_moments
  after insert or update or delete on public.track_lyric_moments for each row
  execute function private.supersede_fused_after_source_change();
create trigger zz_supersede_stale_fused_from_audio_scenes
  after insert or update or delete on public.audio_scenes for each row
  execute function private.supersede_fused_after_source_change();
