-- Supersession is special: the source may already be stale/deleted, but the durable provenance
-- identifiers must remain immutable. Split terminal supersession from normal current-source edits.

create or replace function private.validate_moment_supersede()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.state in ('rejected','superseded') and new.state is distinct from old.state then
    raise exception 'Rejected or superseded Moments are terminal';
  end if;
  if new.state <> 'superseded' then raise exception 'Invalid supersession transition'; end if;

  if new.owner_id is distinct from old.owner_id
    or new.artist_id is distinct from old.artist_id
    or new.release_id is distinct from old.release_id
    or new.track_id is distinct from old.track_id
    or new.start_ms is distinct from old.start_ms
    or new.end_ms is distinct from old.end_ms
    or new.source_start_ms is distinct from old.source_start_ms
    or new.source_end_ms is distinct from old.source_end_ms
    or new.moment_type is distinct from old.moment_type
    or new.label is distinct from old.label
    or new.source_mode is distinct from old.source_mode
    or new.source_fingerprint is distinct from old.source_fingerprint
    or new.purpose_tags is distinct from old.purpose_tags
    or new.energy_score is distinct from old.energy_score
    or new.hook_score is distinct from old.hook_score
    or new.emotional_score is distinct from old.emotional_score
    or new.vocal_score is distinct from old.vocal_score
    or new.uniqueness_score is distinct from old.uniqueness_score
    or new.confidence is distinct from old.confidence
    or new.track_analysis_version is distinct from old.track_analysis_version
    or new.track_analysis_audio_sha256 is distinct from old.track_analysis_audio_sha256
    or new.source_candidate_id is distinct from old.source_candidate_id
    or new.lyric_moment_id is distinct from old.lyric_moment_id
    or new.lyrics_version is distinct from old.lyrics_version
    or new.audio_scene_id is distinct from old.audio_scene_id
    or new.audio_scene_recipe_version is distinct from old.audio_scene_recipe_version
    or new.evidence is distinct from old.evidence
    or new.reviewed_by is distinct from old.reviewed_by
    or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'Superseding a Moment may not rewrite its provenance or reviewed content';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_moment_supersede() from public, anon, authenticated;

drop trigger moments_validate_scope on public.moments;
create trigger moments_validate_insert
  before insert on public.moments
  for each row execute function private.validate_moment_scope();
create trigger moments_validate_update
  before update on public.moments
  for each row when (new.state <> 'superseded')
  execute function private.validate_moment_scope();
create trigger moments_validate_supersede
  before update on public.moments
  for each row when (new.state = 'superseded')
  execute function private.validate_moment_supersede();
