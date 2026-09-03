-- Pure-source Moment fingerprints are deterministic database invariants, not caller input.

create or replace function private.validate_moment_fingerprint()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected text;
  v_audio_sha text;
  v_lyric_source_url text;
  v_lyric_music_version integer;
  v_scene_stem_fingerprint text;
begin
  if new.source_mode = 'audio' then
    select i.audio_sha256 into v_audio_sha
    from public.track_music_intelligence i
    where i.track_id = new.track_id and i.analysis_version = new.track_analysis_version;
    if not found then raise exception 'Cannot fingerprint a missing Track Intelligence source'; end if;
    v_expected := encode(digest(concat_ws('|',
      'audio', new.track_id::text, new.track_analysis_version::text,
      coalesce(v_audio_sha,''), new.source_candidate_id,
      new.source_start_ms::text, new.source_end_ms::text
    ), 'sha256'), 'hex');
  elsif new.source_mode = 'lyrics' then
    select lm.source_audio_url, lm.music_analysis_version
      into v_lyric_source_url, v_lyric_music_version
    from public.track_lyric_moments lm where lm.id = new.lyric_moment_id;
    if not found then raise exception 'Cannot fingerprint a missing lyric Moment source'; end if;
    v_expected := encode(digest(concat_ws('|',
      'lyrics', new.track_id::text, new.lyric_moment_id::text, new.lyrics_version::text,
      new.source_start_ms::text, new.source_end_ms::text,
      coalesce(v_lyric_source_url,''), coalesce(v_lyric_music_version::text,'')
    ), 'sha256'), 'hex');
  elsif new.source_mode = 'stems' then
    select s.stem_set_fingerprint into v_scene_stem_fingerprint
    from public.audio_scenes s where s.id = new.audio_scene_id;
    if not found then raise exception 'Cannot fingerprint a missing Audio Scene source'; end if;
    v_expected := encode(digest(concat_ws('|',
      'stems', new.track_id::text, new.audio_scene_id::text,
      new.audio_scene_recipe_version::text, coalesce(v_scene_stem_fingerprint,''),
      new.source_start_ms::text, new.source_end_ms::text
    ), 'sha256'), 'hex');
  else
    return new;
  end if;

  if new.source_fingerprint is distinct from v_expected then
    raise exception 'Moment source fingerprint must match canonical source lineage';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_moment_fingerprint() from public, anon, authenticated;

create trigger moments_validate_fingerprint
  before insert on public.moments
  for each row execute function private.validate_moment_fingerprint();
