-- Moments must follow the same immutable master identity as the rest of Music Intelligence.
-- Historical source URLs may remain as provenance, but no current Moment validity decision may
-- depend on the denormalized tracks.audio_url column that is removed by the next migration.

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

-- Track-Intelligence evidence is current only when it was produced from the current immutable
-- master asset. URL equality is deliberately not part of the invariant.
create or replace function private.validate_moment_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_artist_id uuid;
  v_release_id uuid;
  v_track_duration integer;
  v_current_master_asset_id uuid;
  v_candidate jsonb;
  v_lyric_track_id uuid;
  v_lyric_version integer;
  v_lyric_start integer;
  v_lyric_end integer;
  v_scene_track_id uuid;
  v_scene_version integer;
  v_scene_start integer;
  v_scene_end integer;
  v_scene_status text;
  v_source_classes integer := 0;
begin
  select t.owner_id, t.artist_id, t.release_id, t.duration
    into v_owner_id, v_artist_id, v_release_id, v_track_duration
  from public.tracks t where t.id = new.track_id;
  if not found then raise exception 'Moment track must exist'; end if;

  v_current_master_asset_id := private.current_track_master_asset_id(new.track_id);

  if new.owner_id <> v_owner_id then raise exception 'Moment owner must match track owner'; end if;
  if new.artist_id <> v_artist_id then raise exception 'Moment artist must match track artist'; end if;
  if new.release_id <> v_release_id then raise exception 'Moment release must match track release'; end if;

  if new.end_ms <= new.start_ms or new.source_end_ms <= new.source_start_ms then
    raise exception 'Moment timing must have a positive duration';
  end if;
  -- Track duration is stored in integer seconds, so allow one second for rounding at the tail.
  if v_track_duration is not null and (
    new.end_ms > v_track_duration * 1000 + 1000
    or new.source_end_ms > v_track_duration * 1000 + 1000
  ) then raise exception 'Moment timing exceeds track duration'; end if;

  if tg_op = 'UPDATE' then
    if new.track_id is distinct from old.track_id
      or new.source_mode is distinct from old.source_mode
      or new.source_fingerprint is distinct from old.source_fingerprint
      or new.source_start_ms is distinct from old.source_start_ms
      or new.source_end_ms is distinct from old.source_end_ms
      or new.track_analysis_version is distinct from old.track_analysis_version
      or new.track_analysis_audio_sha256 is distinct from old.track_analysis_audio_sha256
      or new.source_candidate_id is distinct from old.source_candidate_id
      or new.lyric_moment_id is distinct from old.lyric_moment_id
      or new.lyrics_version is distinct from old.lyrics_version
      or new.audio_scene_id is distinct from old.audio_scene_id
      or new.audio_scene_recipe_version is distinct from old.audio_scene_recipe_version then
      raise exception 'Moment source lineage is immutable; create a superseding proposal instead';
    end if;
    if old.state in ('rejected','superseded') and new.state is distinct from old.state then
      raise exception 'Rejected or superseded Moments are terminal';
    end if;
    if old.state = 'approved' and new.state not in ('approved','superseded') then
      raise exception 'Approved Moments may only remain approved or become superseded';
    end if;
  end if;

  if new.source_candidate_id is not null then
    v_source_classes := v_source_classes + 1;
    if v_current_master_asset_id is null then
      raise exception 'Audio-backed Moment requires a canonical master_audio asset';
    end if;
    select candidate into v_candidate
    from public.track_music_intelligence i
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(i.analysis->'hook_candidates') = 'array'
        then i.analysis->'hook_candidates' else '[]'::jsonb end
    ) candidate
    where i.track_id = new.track_id
      and i.analysis_version = new.track_analysis_version
      and i.source_media_asset_id = v_current_master_asset_id
      and candidate->>'id' = new.source_candidate_id
      and (new.track_analysis_audio_sha256 is null or i.audio_sha256 is not distinct from new.track_analysis_audio_sha256)
    limit 1;
    if v_candidate is null then raise exception 'Moment Track Intelligence candidate must exist on the current master/version'; end if;
    if new.source_mode = 'audio' and (
      new.source_start_ms <> coalesce((v_candidate->>'start_ms')::integer, -1)
      or new.source_end_ms <> coalesce((v_candidate->>'end_ms')::integer, -1)
    ) then raise exception 'Audio Moment source timing must match its Track Intelligence candidate'; end if;
  end if;

  if new.lyric_moment_id is not null then
    v_source_classes := v_source_classes + 1;
    select lm.track_id, lm.lyrics_version, lm.start_ms, lm.end_ms
      into v_lyric_track_id, v_lyric_version, v_lyric_start, v_lyric_end
    from public.track_lyric_moments lm where lm.id = new.lyric_moment_id;
    if not found or v_lyric_track_id <> new.track_id or v_lyric_version <> new.lyrics_version then
      raise exception 'Moment lyric source must belong to the same track/version';
    end if;
    if v_lyric_start is null or v_lyric_end is null then raise exception 'Moment lyric source must have timing'; end if;
    if new.source_mode = 'lyrics' and (
      new.source_start_ms <> v_lyric_start or new.source_end_ms <> v_lyric_end
    ) then raise exception 'Lyrics Moment source timing must match its lyric evidence'; end if;
  end if;

  if new.audio_scene_id is not null then
    v_source_classes := v_source_classes + 1;
    select s.track_id, s.recipe_version, s.recommended_start_ms, s.recommended_end_ms, s.status
      into v_scene_track_id, v_scene_version, v_scene_start, v_scene_end, v_scene_status
    from public.audio_scenes s where s.id = new.audio_scene_id;
    if not found or v_scene_track_id <> new.track_id or v_scene_version <> new.audio_scene_recipe_version then
      raise exception 'Moment Audio Scene source must belong to the same track/recipe version';
    end if;
    if v_scene_status <> 'ready' or v_scene_start is null or v_scene_end is null then
      raise exception 'Moment Audio Scene source must be ready and timed';
    end if;
    if new.source_mode = 'stems' and (
      new.source_start_ms <> v_scene_start or new.source_end_ms <> v_scene_end
    ) then raise exception 'Stem Moment source timing must match its Audio Scene evidence'; end if;
  end if;

  if new.source_mode = 'fused' and v_source_classes < 2 then
    raise exception 'Fused Moments require at least two independent evidence sources';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_moment_scope() from public, anon, authenticated;

-- Re-materialize raw Moment proposals from current canonical intelligence. The materialized Moment
-- keeps historical source URLs only where the source table itself uses them as provenance.
create or replace function private.refresh_track_moments(p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track public.tracks%rowtype;
  v_intelligence public.track_music_intelligence%rowtype;
  v_current_master_asset_id uuid;
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

  v_current_master_asset_id := private.current_track_master_asset_id(p_track_id);

  if v_current_master_asset_id is not null then
    select * into v_intelligence
    from public.track_music_intelligence i
    where i.track_id = p_track_id
      and i.analysis_version >= 3
      and i.source_media_asset_id = v_current_master_asset_id
      and coalesce(i.analysis->>'source', '') = 'worker'
    order by i.analysis_version desc, i.analyzed_at desc
    limit 1;
    v_has_intelligence := found;
  end if;

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
          'source_media_asset_id', v_intelligence.source_media_asset_id,
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

-- Re-materialization reacts to canonical source identity changes, not provenance URL edits.
drop trigger if exists refresh_moments_from_track_intelligence on public.track_music_intelligence;
create trigger refresh_moments_from_track_intelligence
  after insert or update of analysis, analysis_version, audio_sha256, source_media_asset_id or delete
  on public.track_music_intelligence for each row
  execute function private.refresh_moments_after_source_change();

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
        from public.track_music_intelligence i
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(i.analysis->'hook_candidates') = 'array'
            then i.analysis->'hook_candidates' else '[]'::jsonb end
        ) candidate
        where i.track_id = m.track_id
          and i.analysis_version = m.track_analysis_version
          and i.source_media_asset_id = private.current_track_master_asset_id(m.track_id)
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

-- Preserve the previous correct behavior (a master replacement retires every timed proposal), but
-- expose it as an explicit operation that the canonical media-link change event can call.
create or replace function private.supersede_track_moments_on_master_asset_change(p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_track_id is null then return; end if;
  update public.moments
  set state = 'superseded', updated_at = now()
  where track_id = p_track_id
    and state in ('proposed','approved');
end;
$$;
revoke all on function private.supersede_track_moments_on_master_asset_change(uuid)
  from public, anon, authenticated;

-- Remove the last Track-column-bound Moment invalidation path before tracks.audio_url is dropped.
drop trigger if exists zz_supersede_moments_on_master_change on public.tracks;
drop function if exists private.supersede_moments_on_master_change();