-- Preserve optional cross-modal audio semantics on durable Moment evidence without
-- creating a second source of truth. Track Intelligence still owns timing/ranking;
-- semantic descriptors only enrich the matching audio Moment.

create or replace function private.sync_audio_moment_semantic_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate jsonb;
  v_candidate_id text;
begin
  if coalesce(new.analysis->>'source', '') <> 'worker'
     or jsonb_typeof(new.analysis->'hook_candidates') <> 'array' then
    return new;
  end if;

  for v_candidate in
    select value from jsonb_array_elements(new.analysis->'hook_candidates')
  loop
    v_candidate_id := nullif(v_candidate->>'id', '');
    if v_candidate_id is null then
      continue;
    end if;

    update public.moments m
    set evidence =
          (coalesce(m.evidence, '{}'::jsonb)
            - 'semantic_descriptors'
            - 'semantic_embedding_ref')
          || jsonb_strip_nulls(jsonb_build_object(
            'semantic_descriptors', v_candidate->'semantic_descriptors',
            'semantic_embedding_ref', v_candidate->'semantic_embedding_ref'
          )),
        updated_at = now()
    where m.track_id = new.track_id
      and m.source_mode = 'audio'
      and m.source_candidate_id = v_candidate_id
      and m.track_analysis_version = new.analysis_version
      and m.track_analysis_audio_sha256 is not distinct from new.audio_sha256
      and m.state <> 'superseded';
  end loop;

  return new;
end;
$$;

revoke all on function private.sync_audio_moment_semantic_evidence() from public, anon, authenticated;

-- PostgreSQL fires triggers of the same kind alphabetically by name. The zz_ prefix
-- intentionally runs this after refresh_moments_from_track_intelligence has materialized
-- or refreshed the canonical audio Moments for the new analysis payload.
create trigger zz_sync_audio_moment_semantic_evidence
  after insert or update of analysis on public.track_music_intelligence
  for each row execute function private.sync_audio_moment_semantic_evidence();

-- Existing analyses may already contain semantic evidence when this migration is applied
-- in a long-lived environment. Refresh only the semantic fields; no audio analysis is rerun.
do $$
declare
  v_intelligence public.track_music_intelligence%rowtype;
begin
  for v_intelligence in
    select *
    from public.track_music_intelligence
    where coalesce(analysis->>'source', '') = 'worker'
      and jsonb_typeof(analysis->'hook_candidates') = 'array'
  loop
    update public.track_music_intelligence
    set analysis = analysis
    where track_id = v_intelligence.track_id;
  end loop;
end $$;
