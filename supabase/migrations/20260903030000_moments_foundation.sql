-- Ensemblis Moments foundation
-- A Moment is the durable bridge between music intelligence and downstream creation/growth.
-- Existing Track, Lyrics and Stem Intelligence remain canonical evidence producers; this table
-- normalizes their proposals without copying canonical lyrics or Audio Scene recipes.

create type public.moment_source_mode as enum ('audio','lyrics','stems','fused');
create type public.moment_lifecycle_state as enum ('proposed','approved','rejected','superseded');

create table public.moments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete restrict,
  release_id uuid not null references public.releases(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,

  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null,
  source_start_ms integer not null check (source_start_ms >= 0),
  source_end_ms integer not null,

  moment_type text not null,
  label text not null,
  source_mode public.moment_source_mode not null,
  source_fingerprint text not null,
  purpose_tags text[] not null default '{}',

  energy_score numeric(5,4) check (energy_score is null or energy_score between 0 and 1),
  hook_score numeric(5,4) check (hook_score is null or hook_score between 0 and 1),
  emotional_score numeric(5,4) check (emotional_score is null or emotional_score between 0 and 1),
  vocal_score numeric(5,4) check (vocal_score is null or vocal_score between 0 and 1),
  uniqueness_score numeric(5,4) check (uniqueness_score is null or uniqueness_score between 0 and 1),
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),

  -- Provenance references intentionally do not use FKs. Their source rows are refreshable and
  -- may be deleted/replaced; durable Moment history must survive so superseded evidence remains
  -- explainable. The validation trigger requires every reference to exist when proposed.
  track_analysis_version integer check (track_analysis_version is null or track_analysis_version > 0),
  track_analysis_audio_sha256 text,
  source_candidate_id text,
  lyric_moment_id uuid,
  lyrics_version integer check (lyrics_version is null or lyrics_version > 0),
  audio_scene_id uuid,
  audio_scene_recipe_version integer check (audio_scene_recipe_version is null or audio_scene_recipe_version > 0),

  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  state public.moment_lifecycle_state not null default 'proposed',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  superseded_by_id uuid references public.moments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (end_ms > start_ms),
  check (source_end_ms > source_start_ms),
  check ((source_candidate_id is null) = (track_analysis_version is null)),
  check ((lyric_moment_id is null) = (lyrics_version is null)),
  check ((audio_scene_id is null) = (audio_scene_recipe_version is null)),
  check (
    (source_mode = 'audio' and source_candidate_id is not null and lyric_moment_id is null and audio_scene_id is null)
    or (source_mode = 'lyrics' and source_candidate_id is null and lyric_moment_id is not null and audio_scene_id is null)
    or (source_mode = 'stems' and source_candidate_id is null and lyric_moment_id is null and audio_scene_id is not null)
    or (source_mode = 'fused' and num_nonnulls(source_candidate_id, lyric_moment_id, audio_scene_id) >= 2)
  ),
  unique(track_id, source_fingerprint)
);

create index moments_artist_track_state_idx
  on public.moments(artist_id, track_id, state, confidence desc);
create index moments_release_state_idx
  on public.moments(release_id, state, confidence desc);
create index moments_track_timing_idx
  on public.moments(track_id, start_ms, end_ms);
create index moments_lyric_source_idx
  on public.moments(lyric_moment_id) where lyric_moment_id is not null;
create index moments_scene_source_idx
  on public.moments(audio_scene_id) where audio_scene_id is not null;

alter table public.moments enable row level security;

create policy "studio admins artist select moments" on public.moments
  for select to authenticated
  using (private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "studio admins artist insert moments" on public.moments
  for insert to authenticated
  with check (private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "studio admins artist update moments" on public.moments
  for update to authenticated
  using (private.is_studio_admin() and private.can_access_artist(artist_id))
  with check (private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "studio admins artist delete moments" on public.moments
  for delete to authenticated
  using (private.is_studio_admin() and private.can_access_artist(artist_id));

grant select, insert, update, delete on table public.moments to authenticated;
revoke all on table public.moments from anon;

create trigger set_moments_updated_at
  before update on public.moments
  for each row execute function private.set_updated_at();

create or replace function private.moment_score(p_value text, p_fallback numeric default null)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value numeric;
begin
  if p_value is null or btrim(p_value) = '' then return p_fallback; end if;
  begin
    v_value := p_value::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return p_fallback;
  end;
  return greatest(0::numeric, least(1::numeric, v_value));
end;
$$;
revoke all on function private.moment_score(text,numeric) from public, anon, authenticated;

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
  v_candidate jsonb;
  v_lyric record;
  v_scene record;
  v_source_classes integer := 0;
begin
  select t.owner_id, t.artist_id, t.release_id, t.duration
    into v_owner_id, v_artist_id, v_release_id, v_track_duration
  from public.tracks t
  where t.id = new.track_id;

  if v_owner_id is null then raise exception 'Moment track must exist'; end if;
  if new.owner_id is not null and new.owner_id <> v_owner_id then raise exception 'Moment owner must match track owner'; end if;
  if new.artist_id is not null and new.artist_id <> v_artist_id then raise exception 'Moment artist must match track artist'; end if;
  if new.release_id is not null and new.release_id <> v_release_id then raise exception 'Moment release must match track release'; end if;

  new.owner_id := v_owner_id;
  new.artist_id := v_artist_id;
  new.release_id := v_release_id;

  if new.end_ms <= new.start_ms or new.source_end_ms <= new.source_start_ms then
    raise exception 'Moment timing must have a positive duration';
  end if;
  if v_track_duration is not null and (
    new.end_ms > v_track_duration * 1000 + 1000
    or new.source_end_ms > v_track_duration * 1000 + 1000
  ) then
    raise exception 'Moment timing exceeds track duration';
  end if;
  if jsonb_typeof(new.evidence) <> 'object' then raise exception 'Moment evidence must be an object'; end if;

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
    select candidate into v_candidate
    from public.track_music_intelligence i
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(i.analysis->'hook_candidates') = 'array' then i.analysis->'hook_candidates' else '[]'::jsonb end
    ) candidate
    where i.track_id = new.track_id
      and i.analysis_version = new.track_analysis_version
      and candidate->>'id' = new.source_candidate_id
      and (new.track_analysis_audio_sha256 is null or i.audio_sha256 is not distinct from new.track_analysis_audio_sha256)
    limit 1;
    if v_candidate is null then raise exception 'Moment Track Intelligence candidate must exist on the same track/version'; end if;
    if new.source_mode = 'audio' and (
      new.source_start_ms <> coalesce((v_candidate->>'start_ms')::integer, -1)
      or new.source_end_ms <> coalesce((v_candidate->>'end_ms')::integer, -1)
    ) then
      raise exception 'Audio Moment source timing must match its Track Intelligence candidate';
    end if;
  end if;

  if new.lyric_moment_id is not null then
    v_source_classes := v_source_classes + 1;
    select lm.track_id, lm.lyrics_version, lm.start_ms, lm.end_ms
      into v_lyric
    from public.track_lyric_moments lm
    where lm.id = new.lyric_moment_id;
    if v_lyric.track_id is null or v_lyric.track_id <> new.track_id or v_lyric.lyrics_version <> new.lyrics_version then
      raise exception 'Moment lyric source must belong to the same track/version';
    end if;
    if v_lyric.start_ms is null or v_lyric.end_ms is null then raise exception 'Moment lyric source must have timing'; end if;
    if new.source_mode = 'lyrics' and (
      new.source_start_ms <> v_lyric.start_ms or new.source_end_ms <> v_lyric.end_ms
    ) then
      raise exception 'Lyrics Moment source timing must match its lyric evidence';
    end if;
  end if;

  if new.audio_scene_id is not null then
    v_source_classes := v_source_classes + 1;
    select s.track_id, s.recipe_version, s.recommended_start_ms, s.recommended_end_ms, s.status
      into v_scene
    from public.audio_scenes s
    where s.id = new.audio_scene_id;
    if v_scene.track_id is null or v_scene.track_id <> new.track_id or v_scene.recipe_version <> new.audio_scene_recipe_version then
      raise exception 'Moment Audio Scene source must belong to the same track/recipe version';
    end if;
    if v_scene.status <> 'ready' or v_scene.recommended_start_ms is null or v_scene.recommended_end_ms is null then
      raise exception 'Moment Audio Scene source must be ready and timed';
    end if;
    if new.source_mode = 'stems' and (
      new.source_start_ms <> v_scene.recommended_start_ms or new.source_end_ms <> v_scene.recommended_end_ms
    ) then
      raise exception 'Stem Moment source timing must match its Audio Scene evidence';
    end if;
  end if;

  if new.source_mode = 'fused' and v_source_classes < 2 then
    raise exception 'Fused Moments require at least two independent evidence sources';
  end if;

  return new;
end;
$$;
revoke all on function private.validate_moment_scope() from public, anon, authenticated;

create trigger moments_validate_scope
  before insert or update on public.moments
  for each row execute function private.validate_moment_scope();

create or replace function private.refresh_track_moments(p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track record;
  v_intelligence record;
  v_candidate jsonb;
  v_lyric record;
  v_scene record;
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
  select t.id, t.owner_id, t.artist_id, t.release_id, t.audio_url
    into v_track
  from public.tracks t
  where t.id = p_track_id;
  if v_track.id is null then return; end if;

  select i.track_id, i.analysis_version, i.audio_sha256, i.source_audio_url, i.analysis
    into v_intelligence
  from public.track_music_intelligence i
  where i.track_id = p_track_id
    and i.analysis_version >= 3
    and i.source_audio_url is not distinct from v_track.audio_url
    and coalesce(i.analysis->>'source', '') = 'worker';

  if v_intelligence.track_id is not null and jsonb_typeof(v_intelligence.analysis->'hook_candidates') = 'array' then
    for v_candidate in select value from jsonb_array_elements(v_intelligence.analysis->'hook_candidates') loop
      begin
        v_start := (v_candidate->>'start_ms')::integer;
        v_end := (v_candidate->>'end_ms')::integer;
      exception when invalid_text_representation or numeric_value_out_of_range then
        continue;
      end;
      if v_start < 0 or v_end <= v_start then continue; end if;
      if nullif(v_candidate->>'id','') is null then continue; end if;

      v_fingerprint := encode(digest(concat_ws('|',
        'audio', p_track_id::text, v_intelligence.analysis_version::text,
        coalesce(v_intelligence.audio_sha256,''), v_candidate->>'id', v_start::text, v_end::text
      ), 'sha256'), 'hex');
      v_audio_fingerprints := array_append(v_audio_fingerprints, v_fingerprint);
      v_energy := private.moment_score(v_candidate#>>'{metrics,energy}', null);
      v_hook := private.moment_score(v_candidate#>>'{intent_scores,instant_hook}', private.moment_score(v_candidate->>'score', 0));
      v_uniqueness := private.moment_score(v_candidate#>>'{metrics,novelty}', private.moment_score(v_candidate#>>'{metrics,harmonic_distinctiveness}', null));
      v_confidence := private.moment_score(v_candidate->>'score', 0);

      insert into public.moments(
        owner_id, artist_id, release_id, track_id,
        start_ms, end_ms, source_start_ms, source_end_ms,
        moment_type, label, source_mode, source_fingerprint, purpose_tags,
        energy_score, hook_score, uniqueness_score, confidence,
        track_analysis_version, track_analysis_audio_sha256, source_candidate_id,
        evidence
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

  update public.moments
  set state = 'superseded', updated_at = now()
  where track_id = p_track_id
    and source_mode = 'audio'
    and state in ('proposed','approved')
    and not (source_fingerprint = any(v_audio_fingerprints));

  for v_lyric in
    select lm.*
    from public.track_lyric_moments lm
    where lm.track_id = p_track_id
      and lm.start_ms is not null
      and lm.end_ms is not null
      and lm.end_ms > lm.start_ms
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
      coalesce(v_lyric.purpose_tags[1], 'lyric'), v_lyric.title,
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

  update public.moments
  set state = 'superseded', updated_at = now()
  where track_id = p_track_id
    and source_mode = 'lyrics'
    and state in ('proposed','approved')
    and not (source_fingerprint = any(v_lyric_fingerprints));

  for v_scene in
    select s.*
    from public.audio_scenes s
    where s.track_id = p_track_id
      and s.status = 'ready'
      and s.recommended_start_ms is not null
      and s.recommended_end_ms is not null
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

  update public.moments
  set state = 'superseded', updated_at = now()
  where track_id = p_track_id
    and source_mode = 'stems'
    and state in ('proposed','approved')
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
  if tg_op = 'DELETE' then
    v_track_id := old.track_id;
  else
    v_track_id := new.track_id;
  end if;
  perform private.refresh_track_moments(v_track_id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.refresh_moments_after_source_change() from public, anon, authenticated;

create trigger refresh_moments_from_track_intelligence
  after insert or update of analysis, analysis_version, audio_sha256, source_audio_url or delete
  on public.track_music_intelligence
  for each row execute function private.refresh_moments_after_source_change();

create trigger refresh_moments_from_lyric_moments
  after insert or update or delete on public.track_lyric_moments
  for each row execute function private.refresh_moments_after_source_change();

create trigger refresh_moments_from_audio_scenes
  after insert or update or delete on public.audio_scenes
  for each row execute function private.refresh_moments_after_source_change();

create or replace function private.supersede_moments_on_master_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.audio_url is not distinct from new.audio_url then return new; end if;
  update public.moments
  set state = 'superseded', updated_at = now()
  where track_id = new.id and state in ('proposed','approved');
  return new;
end;
$$;
revoke all on function private.supersede_moments_on_master_change() from public, anon, authenticated;

-- The zz prefix intentionally runs this after the existing intelligence invalidation triggers.
create trigger zz_supersede_moments_on_master_change
  after update of audio_url on public.tracks
  for each row execute function private.supersede_moments_on_master_change();

-- Existing intelligence becomes first-class Moment proposals immediately after migration.
do $$
declare
  v_track_id uuid;
begin
  for v_track_id in select id from public.tracks loop
    perform private.refresh_track_moments(v_track_id);
  end loop;
end $$;
