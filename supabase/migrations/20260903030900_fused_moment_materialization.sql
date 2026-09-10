-- Build higher-confidence fused proposals when independent intelligence sources agree on the same
-- musical window. Pure Track/Lyrics/Stem intelligence remains canonical; fused Moments only point
-- back to those durable source references.

create or replace function private.refresh_fused_track_moments(p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = 'extensions', 'pg_catalog'
as $$
declare
  v_track public.tracks%rowtype;
  v_pair record;
  v_fingerprint text;
  v_fingerprints text[] := '{}'::text[];
  v_start integer;
  v_end integer;
  v_overlap_ratio numeric;
  v_confidence numeric;
  v_tags text[];
begin
  select * into v_track from public.tracks where id = p_track_id;
  if not found then return; end if;

  for v_pair in
    select
      a.id as a_id,
      a.source_mode as a_mode,
      a.source_fingerprint as a_fingerprint,
      a.source_start_ms as a_start,
      a.source_end_ms as a_end,
      a.label as a_label,
      a.purpose_tags as a_tags,
      a.energy_score as a_energy,
      a.hook_score as a_hook,
      a.emotional_score as a_emotional,
      a.vocal_score as a_vocal,
      a.uniqueness_score as a_uniqueness,
      a.confidence as a_confidence,
      a.track_analysis_version as a_track_version,
      a.track_analysis_audio_sha256 as a_audio_sha,
      a.source_candidate_id as a_candidate,
      a.lyric_moment_id as a_lyric,
      a.lyrics_version as a_lyrics_version,
      a.audio_scene_id as a_scene,
      a.audio_scene_recipe_version as a_scene_version,
      b.id as b_id,
      b.source_mode as b_mode,
      b.source_fingerprint as b_fingerprint,
      b.source_start_ms as b_start,
      b.source_end_ms as b_end,
      b.label as b_label,
      b.purpose_tags as b_tags,
      b.energy_score as b_energy,
      b.hook_score as b_hook,
      b.emotional_score as b_emotional,
      b.vocal_score as b_vocal,
      b.uniqueness_score as b_uniqueness,
      b.confidence as b_confidence,
      b.track_analysis_version as b_track_version,
      b.track_analysis_audio_sha256 as b_audio_sha,
      b.source_candidate_id as b_candidate,
      b.lyric_moment_id as b_lyric,
      b.lyrics_version as b_lyrics_version,
      b.audio_scene_id as b_scene,
      b.audio_scene_recipe_version as b_scene_version
    from public.moments a
    join public.moments b
      on b.track_id = a.track_id
      and b.id > a.id
      and b.source_mode <> a.source_mode
      and b.source_mode in ('audio','lyrics','stems')
      and b.state in ('proposed','approved')
    where a.track_id = p_track_id
      and a.source_mode in ('audio','lyrics','stems')
      and a.state in ('proposed','approved')
  loop
    v_start := greatest(v_pair.a_start, v_pair.b_start);
    v_end := least(v_pair.a_end, v_pair.b_end);
    if v_end - v_start < 3000 then continue; end if;

    v_overlap_ratio := (v_end - v_start)::numeric /
      greatest(1, least(v_pair.a_end - v_pair.a_start, v_pair.b_end - v_pair.b_start));
    if v_overlap_ratio < 0.40 then continue; end if;

    v_fingerprint := encode(digest(concat_ws('|',
      'fused', p_track_id::text,
      least(v_pair.a_fingerprint, v_pair.b_fingerprint),
      greatest(v_pair.a_fingerprint, v_pair.b_fingerprint),
      v_start::text, v_end::text
    ), 'sha256'), 'hex');
    v_fingerprints := array_append(v_fingerprints, v_fingerprint);

    select coalesce(array_agg(distinct tag order by tag), '{}'::text[])
      into v_tags
    from unnest(coalesce(v_pair.a_tags, '{}'::text[]) || coalesce(v_pair.b_tags, '{}'::text[])) tag;

    v_confidence := least(
      1::numeric,
      greatest(0::numeric, (coalesce(v_pair.a_confidence, 0) + coalesce(v_pair.b_confidence, 0)) / 2 + 0.08)
    );

    insert into public.moments(
      owner_id, artist_id, release_id, track_id,
      start_ms, end_ms, source_start_ms, source_end_ms,
      moment_type, label, source_mode, source_fingerprint, purpose_tags,
      energy_score, hook_score, emotional_score, vocal_score, uniqueness_score, confidence,
      track_analysis_version, track_analysis_audio_sha256, source_candidate_id,
      lyric_moment_id, lyrics_version, audio_scene_id, audio_scene_recipe_version,
      evidence
    ) values (
      v_track.owner_id, v_track.artist_id, v_track.release_id, p_track_id,
      v_start, v_end, v_start, v_end,
      concat('fused_', v_pair.a_mode::text, '_', v_pair.b_mode::text),
      concat('Fused · ', v_pair.a_label, ' + ', v_pair.b_label),
      'fused', v_fingerprint, v_tags,
      greatest(v_pair.a_energy, v_pair.b_energy),
      greatest(v_pair.a_hook, v_pair.b_hook),
      greatest(v_pair.a_emotional, v_pair.b_emotional),
      greatest(v_pair.a_vocal, v_pair.b_vocal),
      greatest(v_pair.a_uniqueness, v_pair.b_uniqueness),
      v_confidence,
      coalesce(v_pair.a_track_version, v_pair.b_track_version),
      coalesce(v_pair.a_audio_sha, v_pair.b_audio_sha),
      coalesce(v_pair.a_candidate, v_pair.b_candidate),
      coalesce(v_pair.a_lyric, v_pair.b_lyric),
      coalesce(v_pair.a_lyrics_version, v_pair.b_lyrics_version),
      coalesce(v_pair.a_scene, v_pair.b_scene),
      coalesce(v_pair.a_scene_version, v_pair.b_scene_version),
      jsonb_build_object(
        'agreement', 'overlapping_independent_sources',
        'source_moment_ids', jsonb_build_array(v_pair.a_id, v_pair.b_id),
        'source_modes', jsonb_build_array(v_pair.a_mode::text, v_pair.b_mode::text),
        'overlap_ms', v_end - v_start,
        'overlap_ratio', round(v_overlap_ratio, 4)
      )
    )
    on conflict (track_id, source_fingerprint) do update set
      moment_type = excluded.moment_type,
      label = excluded.label,
      purpose_tags = excluded.purpose_tags,
      energy_score = excluded.energy_score,
      hook_score = excluded.hook_score,
      emotional_score = excluded.emotional_score,
      vocal_score = excluded.vocal_score,
      uniqueness_score = excluded.uniqueness_score,
      confidence = excluded.confidence,
      evidence = excluded.evidence,
      updated_at = now()
    where public.moments.state = 'proposed';
  end loop;

  update public.moments
  set state = 'superseded', updated_at = now()
  where track_id = p_track_id
    and source_mode = 'fused'
    and state in ('proposed','approved')
    and not (source_fingerprint = any(v_fingerprints));
end;
$$;
revoke all on function private.refresh_fused_track_moments(uuid) from public, anon, authenticated;

create or replace function private.refresh_moments_after_source_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track_id uuid;
begin
  v_track_id := case when tg_op = 'DELETE' then old.track_id else new.track_id end;
  perform private.refresh_track_moments(v_track_id);
  perform private.refresh_fused_track_moments(v_track_id);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.refresh_moments_after_source_change() from public, anon, authenticated;

do $$
declare
  v_track_id uuid;
begin
  for v_track_id in select id from public.tracks loop
    perform private.refresh_fused_track_moments(v_track_id);
  end loop;
end $$;
