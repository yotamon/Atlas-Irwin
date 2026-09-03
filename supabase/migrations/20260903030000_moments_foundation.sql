-- Ensemblis Moments foundation.
-- Intelligence sources remain canonical. Moments normalize their evidence into one durable,
-- reviewable bridge for creation, campaigns, attribution and learning.

create type public.moment_source_mode as enum ('audio','lyrics','stems','fused');
create type public.moment_lifecycle_state as enum ('proposed','approved','rejected','superseded');

create table public.moments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete restrict,
  release_id uuid not null references public.releases(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,

  -- Effective timing can be artist-edited after review. Source timing is immutable provenance.
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

  -- These are durable provenance identifiers rather than FKs. Track/Lyric/Scene intelligence is
  -- refreshable and may delete/replace proposals; superseded Moment history must remain explainable.
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

create index moments_artist_track_state_idx on public.moments(artist_id, track_id, state, confidence desc);
create index moments_release_state_idx on public.moments(release_id, state, confidence desc);
create index moments_track_timing_idx on public.moments(track_id, start_ms, end_ms);
create index moments_lyric_source_idx on public.moments(lyric_moment_id) where lyric_moment_id is not null;
create index moments_scene_source_idx on public.moments(audio_scene_id) where audio_scene_id is not null;

alter table public.moments enable row level security;
create policy "studio admins artist select moments" on public.moments
  for select to authenticated using (private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "studio admins artist insert moments" on public.moments
  for insert to authenticated with check (private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "studio admins artist update moments" on public.moments
  for update to authenticated using (private.is_studio_admin() and private.can_access_artist(artist_id))
  with check (private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "studio admins artist delete moments" on public.moments
  for delete to authenticated using (private.is_studio_admin() and private.can_access_artist(artist_id));

grant select, insert, update, delete on table public.moments to authenticated;
revoke all on table public.moments from anon;

create trigger set_moments_updated_at before update on public.moments
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
  v_track_audio_url text;
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
  select t.owner_id, t.artist_id, t.release_id, t.duration, t.audio_url
    into v_owner_id, v_artist_id, v_release_id, v_track_duration, v_track_audio_url
  from public.tracks t where t.id = new.track_id;
  if not found then raise exception 'Moment track must exist'; end if;

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
    select candidate into v_candidate
    from public.track_music_intelligence i
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(i.analysis->'hook_candidates') = 'array'
        then i.analysis->'hook_candidates' else '[]'::jsonb end
    ) candidate
    where i.track_id = new.track_id
      and i.analysis_version = new.track_analysis_version
      and i.source_audio_url is not distinct from v_track_audio_url
      and candidate->>'id' = new.source_candidate_id
      and (new.track_analysis_audio_sha256 is null or i.audio_sha256 is not distinct from new.track_analysis_audio_sha256)
    limit 1;
    if v_candidate is null then raise exception 'Moment Track Intelligence candidate must exist on the current track/version'; end if;
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

create trigger moments_validate_scope before insert or update on public.moments
  for each row execute function private.validate_moment_scope();
