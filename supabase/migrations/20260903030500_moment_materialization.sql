-- Normalize existing intelligence into durable Moment proposals. No analysis is re-run here.

create or replace function private.refresh_track_moments(p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track public.tracks%rowtype;
  v_intelligence public.track_music_intelligence%rowtype;
  v_has_intelligence boolean := false;
  v_candidate jsonb;
  v_lyric public.track_lyric_moments%rowtype;
  v_scene public.audio_scenes%rowtype;
  v_fingerprint text;
  v_audio_fingerprints text[] := '{}'::text[];
  v_lyric_fingerprints text[] := '{}'::text[];
  v_scene_fingerprints text[] := '{}'::text[];
  v_start integer;
  v_end integer;
  v_energy numeric;
  v_hook numeric;
  v_uniqueness numeric;
  v_confidence numeric;
begin
  select * into v_track from public.tracks where id = p_track_id;
  if not found then return; end if;

  select * into v_intelligence
  from public.track_music_intelligence i
  where i.track_id = p_track_id
    and i.analysis_version >= 3
    and i.source_audio_url is not distinct from v_track.audio_url
    and coalesce(i.analysis->>'source', '') = 'worker';
  v_has_intelligence := found;

  if v_has_intelligence and jsonb_typeof(v_intelligence.analysis->'hook_candidates') = 'array' then
    for v_candidate in select value from jsonb_array_elements(v_intelligence.analysis->'hook_candidates') loop
      begin
        v_start := (v_candidate->>'start_ms')::integer;
        v_end := (v_candidate->>'end_ms')::integer;
      exception when invalid_text_representation or numeric_value_out_of_range then
        continue;
      end;
      if v_start < 0 or v_end <= v_start or nullif(v_candidate->>'id','') is null then continue; end if;

      v_fingerprint := encode(digest(concat_ws('|',
        'audio', p_track_id::text, v_intelligence.analysis_version::text,
        coalesce(v_intelligence.audio_sha256,''), v_candidate->>'id', v_start::text, v_end::text
      ), 'sha256'), 'hex');
      v_audio_fingerprints := array_append(v_audio_fingerprints, v_fingerprint);
      v_energy := private.moment_score(v_candidate#>>'{metrics,energy}', null);
      v_hook := private.moment_score(
        v_candidate#>>'{intent_scores,instant_hook}',
        private.moment_score(v_candidate->>'score', 0)
      );
      v_uniqueness := private.moment_score(
        v_candidate#>>'{metrics,novelty}',
        private.moment_score(v_candidate#>>'{metrics,harmonic_distinctiveness}', null)
      );
      v_confidence := private.moment_score(v_candidate->>'score', 0);

      insert into public.moments(
        owner_id, artist_id, release_id, track_id,
        start_ms, end_ms, source_start_ms, source_end_ms,
        moment_type, label, source_mode, source_fingerprint, purpose_tags,
        energy_score, hook_score, uniqueness_score, confidence,
        track_analysis_version, track_analysis_audio_sha256, source_candidate_id, evidence
      ) values (
        v_track.owner_id, v_track.artist_id, v_track.release_id, p_track_id,
        v_start, v_end, v_start, v_end,
        coalesce(nullif(v_candidate->>'kind',''), 'audio'),
        coalesce(nullif(v_candidate->>'label',''), 'Music moment'),
        'audio', v_fingerprint,
        array[coalesce(nullif(v_candidate->>'kind',''), 'audio')],
        v_energy, v_hook, v_uniqueness, coalesce(v_confidence, 0),
        v_intelligence.analysis_version, v_intelligence.audio_sha256, v_candidate->>'id',
        jsonb_strip_nulls(jsonb_build_object(
          'analysis_version', v_intelligence.analysis_version,
          'audio_sha256', v_intelligence.audio_sha256,
          'section_type', v_candidate->>'section_type',
          'section_label', v_candidate->>'section_label',
          'metrics', v_candidate->'metrics',
          'intent_scores', v_candidate->'intent_scores',
          'reasons', v_candidate->'reasons'
        ))
      )
      on conflict (track_id, source_fingerprint) do update set
        moment_type = excluded.moment_type,
        label = excluded.label,
        purpose_tags = excluded.purpose_tags,
        energy_score = excluded.energy_score,
        hook_score = excluded.hook_score,
        uniqueness_score = excluded.uniqueness_score,
        confidence = excluded.confidence,
        evidence = excluded.evidence,
        updated_at = now()
      where public.moments.state = 'proposed';
    end loop;
  end if;

  update public.moments set state = 'superseded', updated_at = now()
  where track_id = p_track_id and source_mode = 'audio' and state in ('proposed','approved')
    and not (source_fingerprint = any(v_audio_fingerprints));

  for v_lyric in
    select * from public.track_lyric_moments lm
    where lm.track_id = p_track_id
      and lm.start_ms is not null and lm.end_ms is not null and lm.end_ms > lm.start_ms
      and (lm.source_audio_url is null or lm.source_audio_url is not distinct from v_track.audio_url)
  loop
    v_fingerprint := encode(digest(concat_ws('|',
      'lyrics', p_track_id::text, v_lyric.id::text, v_lyric.lyrics_version::text,
      v_lyric.start_ms::text, v_lyric.end_ms::text,
      coalesce(v_lyric.source_audio_url,''), coalesce(v_lyric.music_analysis_version::text,'')
    ), 'sha256'), 'hex');
    v_lyric_fingerprints := array_append(v_lyric_fingerprints, v_fingerprint);
    v_confidence := private.moment_score(v_lyric.score::text, 0);

    insert into public.moments(
      owner_id, artist_id, release_id, track_id,
      start_ms, end_ms, source_start_ms, source_end_ms,
      moment_type, label, source_mode, source_fingerprint, purpose_tags,
      hook_score, confidence, lyric_moment_id, lyrics_version, evidence
    ) values (
      v_track.owner_id, v_track.artist_id, v_track.release_id, p_track_id,
      v_lyric.start_ms, v_lyric.end_ms, v_lyric.start_ms, v_lyric.end_ms,
      coalesce((v_lyric.purpose_tags)[1], 'lyric'), v_lyric.title,
      'lyrics', v_fingerprint, coalesce(v_lyric.purpose_tags, '{}'::text[]),
      v_confidence, v_confidence, v_lyric.id, v_lyric.lyrics_version,
      jsonb_strip_nulls(jsonb_build_object(
        'lyrics_version', v_lyric.lyrics_version,
        'section_key', v_lyric.section_key,
        'interpretation', v_lyric.interpretation,
        'timing_source', v_lyric.timing_source,
        'music_analysis_version', v_lyric.music_analysis_version,
        'visual_directions', to_jsonb(v_lyric.visual_directions),
        'allow_media', v_lyric.allow_media
      ))
    )
    on conflict (track_id, source_fingerprint) do update set
      moment_type = excluded.moment_type,
      label = excluded.label,
      purpose_tags = excluded.purpose_tags,
      hook_score = excluded.hook_score,
      confidence = excluded.confidence,
      evidence = excluded.evidence,
      updated_at = now()
    where public.moments.state = 'proposed';
  end loop;

  update public.moments set state = 'superseded', updated_at = now()
  where track_id = p_track_id and source_mode = 'lyrics' and state in ('proposed','approved')
    and not (source_fingerprint = any(v_lyric_fingerprints));

  for v_scene in
    select * from public.audio_scenes s
    where s.track_id = p_track_id and s.status = 'ready'
      and s.recommended_start_ms is not null and s.recommended_end_ms is not null
      and s.recommended_end_ms > s.recommended_start_ms
  loop
    v_fingerprint := encode(digest(concat_ws('|',
      'stems', p_track_id::text, v_scene.id::text, v_scene.recipe_version::text,
      coalesce(v_scene.stem_set_fingerprint,''),
      v_scene.recommended_start_ms::text, v_scene.recommended_end_ms::text
    ), 'sha256'), 'hex');
    v_scene_fingerprints := array_append(v_scene_fingerprints, v_fingerprint);
    v_confidence := private.moment_score(v_scene.score::text, 0);

    insert into public.moments(
      owner_id, artist_id, release_id, track_id,
      start_ms, end_ms, source_start_ms, source_end_ms,
      moment_type, label, source_mode, source_fingerprint, purpose_tags,
      vocal_score, confidence, audio_scene_id, audio_scene_recipe_version, evidence
    ) values (
      v_track.owner_id, v_track.artist_id, v_track.release_id, p_track_id,
      v_scene.recommended_start_ms, v_scene.recommended_end_ms,
      v_scene.recommended_start_ms, v_scene.recommended_end_ms,
      v_scene.scene_type, v_scene.name, 'stems', v_fingerprint,
      coalesce(v_scene.objective_tags, '{}'::text[]),
      case when v_scene.scene_type in ('vocal_spotlight','vocal_to_drop') then 0.9 else null end,
      v_confidence, v_scene.id, v_scene.recipe_version,
      jsonb_strip_nulls(jsonb_build_object(
        'scene_type', v_scene.scene_type,
        'recipe_version', v_scene.recipe_version,
        'stem_set_fingerprint', v_scene.stem_set_fingerprint,
        'objective_tags', to_jsonb(v_scene.objective_tags),
        'platform_hints', to_jsonb(v_scene.platform_hints),
        'rationale', v_scene.rationale,
        'status', v_scene.status
      ))
    )
    on conflict (track_id, source_fingerprint) do update set
      moment_type = excluded.moment_type,
      label = excluded.label,
      purpose_tags = excluded.purpose_tags,
      vocal_score = excluded.vocal_score,
      confidence = excluded.confidence,
      evidence = excluded.evidence,
      updated_at = now()
    where public.moments.state = 'proposed';
  end loop;

  update public.moments set state = 'superseded', updated_at = now()
  where track_id = p_track_id and source_mode = 'stems' and state in ('proposed','approved')
    and not (source_fingerprint = any(v_scene_fingerprints));
end;
$$;
revoke all on function private.refresh_track_moments(uuid) from public, anon, authenticated;

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
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.refresh_moments_after_source_change() from public, anon, authenticated;

create trigger refresh_moments_from_track_intelligence
  after insert or update of analysis, analysis_version, audio_sha256, source_audio_url or delete
  on public.track_music_intelligence for each row
  execute function private.refresh_moments_after_source_change();
create trigger refresh_moments_from_lyric_moments
  after insert or update or delete on public.track_lyric_moments for each row
  execute function private.refresh_moments_after_source_change();
create trigger refresh_moments_from_audio_scenes
  after insert or update or delete on public.audio_scenes for each row
  execute function private.refresh_moments_after_source_change();

create or replace function private.supersede_moments_on_master_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.audio_url is not distinct from new.audio_url then return new; end if;
  update public.moments set state = 'superseded', updated_at = now()
  where track_id = new.id and state in ('proposed','approved');
  return new;
end;
$$;
revoke all on function private.supersede_moments_on_master_change() from public, anon, authenticated;

-- Runs after the older intelligence invalidation triggers, ensuring no timed proposal survives
-- a canonical-master replacement merely because its source row was retained for history.
create trigger zz_supersede_moments_on_master_change
  after update of audio_url on public.tracks for each row
  execute function private.supersede_moments_on_master_change();

-- Backfill existing intelligence without recomputation.
do $$
declare
  v_track_id uuid;
begin
  for v_track_id in select id from public.tracks loop
    perform private.refresh_track_moments(v_track_id);
  end loop;
end $$;
