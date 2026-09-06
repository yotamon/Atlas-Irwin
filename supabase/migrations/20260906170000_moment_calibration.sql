-- Ensemblis Moment calibration.
-- Explicit artist judgment is append-only evidence around canonical Moments. It may reorder otherwise
-- valid choices, but it never rewrites Track/Lyrics/Stem Intelligence or immutable Moment provenance.

create type public.moment_calibration_judgment as enum ('best','useful','poor','adjustment');

grant usage on type public.moment_calibration_judgment to authenticated;

create table public.moment_calibration_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete restrict,
  release_id uuid not null references public.releases(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  moment_id uuid not null references public.moments(id) on delete restrict,

  -- Snapshot the exact source identity that was judged. A re-analysis or master replacement creates
  -- different provenance and therefore makes this event historical rather than executable evidence.
  moment_source_fingerprint text not null,
  moment_track_analysis_version integer,
  moment_track_analysis_audio_sha256 text,
  source_start_ms integer not null check (source_start_ms >= 0),
  source_end_ms integer not null,

  -- Preserve what the artist saw before and after an adjustment without mutating source timing.
  previous_start_ms integer not null check (previous_start_ms >= 0),
  previous_end_ms integer not null,
  effective_start_ms integer not null check (effective_start_ms >= 0),
  effective_end_ms integer not null,

  judgment public.moment_calibration_judgment not null,
  corrected_purpose text check (corrected_purpose is null or char_length(corrected_purpose) <= 180),
  preferred_cut_seconds integer check (preferred_cut_seconds is null or preferred_cut_seconds in (6,8,15,30)),
  preferred_moment_id uuid references public.moments(id) on delete restrict,
  preferred_moment_source_fingerprint text,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),

  check (source_end_ms > source_start_ms),
  check (previous_end_ms > previous_start_ms),
  check (effective_end_ms > effective_start_ms),
  check ((preferred_moment_id is null) = (preferred_moment_source_fingerprint is null)),
  check (preferred_moment_id is null or preferred_moment_id <> moment_id)
);

create index moment_calibration_artist_recent_idx
  on public.moment_calibration_events(owner_id, artist_id, created_at desc);
create index moment_calibration_moment_recent_idx
  on public.moment_calibration_events(moment_id, created_at desc);
create index moment_calibration_preferred_idx
  on public.moment_calibration_events(preferred_moment_id, created_at desc)
  where preferred_moment_id is not null;

alter table public.moment_calibration_events enable row level security;

create policy "studio admins artist select moment calibration"
  on public.moment_calibration_events
  for select to authenticated
  using (
    owner_id = auth.uid()
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

-- Authenticated product clients can only read their evidence. The security-definer review RPC is the
-- sole append path, so no client can edit/delete history or fabricate calibration around another Moment.
revoke all on table public.moment_calibration_events from anon, authenticated;
grant select on table public.moment_calibration_events to authenticated;

comment on table public.moment_calibration_events is
  'Append-only explicit artist judgment over a specific canonical Moment provenance snapshot. Never rewrite source intelligence from this table.';

create or replace function private.moment_calibration_delta(p_moment_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select m.*
    from public.moments m
    where m.id = p_moment_id
  ), latest_exact as (
    select distinct on (e.moment_id)
      e.*
    from public.moment_calibration_events e
    join public.moments source_moment on source_moment.id = e.moment_id
    join target t on t.artist_id = e.artist_id
    where e.owner_id = source_moment.owner_id
      and e.artist_id = source_moment.artist_id
      and e.release_id = source_moment.release_id
      and e.track_id = source_moment.track_id
      and e.moment_source_fingerprint = source_moment.source_fingerprint
      and e.moment_track_analysis_version is not distinct from source_moment.track_analysis_version
      and e.moment_track_analysis_audio_sha256 is not distinct from source_moment.track_analysis_audio_sha256
      and e.source_start_ms = source_moment.source_start_ms
      and e.source_end_ms = source_moment.source_end_ms
    order by e.moment_id, e.created_at desc, e.id desc
  ), direct as (
    select
      case e.judgment
        when 'best' then 0.18::numeric
        when 'useful' then 0.08::numeric
        when 'poor' then -0.18::numeric
        else 0::numeric
      end
      + case when e.preferred_moment_id is not null then -0.06::numeric else 0::numeric end as delta
    from latest_exact e
    where e.moment_id = p_moment_id
  ), incoming as (
    select case when exists (
      select 1
      from latest_exact e
      join target t on true
      where e.moment_id <> p_moment_id
        and e.preferred_moment_id = p_moment_id
        and e.preferred_moment_source_fingerprint = t.source_fingerprint
    ) then 0.14::numeric else 0::numeric end as delta
  )
  select greatest(
    -0.20::numeric,
    least(0.20::numeric, coalesce((select delta from direct), 0::numeric) + (select delta from incoming))
  );
$$;
revoke all on function private.moment_calibration_delta(uuid) from public, anon, authenticated;

create or replace function public.review_moment_with_calibration(
  p_moment_id uuid,
  p_release_id uuid,
  p_decision text,
  p_start_ms integer,
  p_end_ms integer,
  p_label text,
  p_judgment public.moment_calibration_judgment,
  p_corrected_purpose text default null,
  p_preferred_cut_seconds integer default null,
  p_preferred_moment_id uuid default null,
  p_evidence jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_moment public.moments%rowtype;
  v_preferred public.moments%rowtype;
  v_event_id uuid;
  v_next_state public.moment_lifecycle_state;
  v_reviewed boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not private.is_studio_admin() then raise exception 'Studio admin access required'; end if;
  if p_decision not in ('save','approve','reject') then raise exception 'Unsupported Moment review decision'; end if;
  if p_start_ms < 0 or p_end_ms <= p_start_ms then raise exception 'Moment end must be after its start'; end if;
  if p_label is null or char_length(btrim(p_label)) < 1 or char_length(btrim(p_label)) > 180 then
    raise exception 'Moment label must be between 1 and 180 characters';
  end if;
  if p_corrected_purpose is not null and char_length(btrim(p_corrected_purpose)) > 180 then
    raise exception 'Corrected purpose must be at most 180 characters';
  end if;
  if p_preferred_cut_seconds is not null and p_preferred_cut_seconds not in (6,8,15,30) then
    raise exception 'Preferred cut must be 6, 8, 15, or 30 seconds';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'Calibration evidence must be a JSON object';
  end if;

  select m.* into v_moment
  from public.moments m
  where m.id = p_moment_id
    and m.release_id = p_release_id
    and m.owner_id = v_user_id
  for update;
  if not found then raise exception 'Moment not found for the current owner and Release'; end if;
  if not private.can_access_artist(v_moment.artist_id) then raise exception 'Moment Artist is not accessible'; end if;
  if v_moment.state in ('rejected','superseded') then
    raise exception 'This Moment is historical and can no longer be edited';
  end if;
  if p_decision = 'reject' and v_moment.state <> 'proposed' then
    raise exception 'Only proposed Moments can be rejected';
  end if;

  if p_preferred_moment_id is not null then
    if p_preferred_moment_id = p_moment_id then raise exception 'Preferred Moment must be a different Moment'; end if;
    select m.* into v_preferred
    from public.moments m
    where m.id = p_preferred_moment_id
      and m.owner_id = v_moment.owner_id
      and m.artist_id = v_moment.artist_id
      and m.release_id = v_moment.release_id
      and m.track_id = v_moment.track_id
      and m.state in ('proposed','approved');
    if not found then raise exception 'Preferred Moment must be an active Moment from the same track'; end if;
  end if;

  v_next_state := case p_decision
    when 'approve' then 'approved'::public.moment_lifecycle_state
    when 'reject' then 'rejected'::public.moment_lifecycle_state
    else v_moment.state
  end;
  v_reviewed := p_decision in ('approve','reject');

  update public.moments
  set
    start_ms = p_start_ms,
    end_ms = p_end_ms,
    label = btrim(p_label),
    state = v_next_state,
    reviewed_by = case when v_reviewed then v_user_id else reviewed_by end,
    reviewed_at = case when v_reviewed then now() else reviewed_at end
  where id = v_moment.id;

  insert into public.moment_calibration_events(
    owner_id, artist_id, release_id, track_id, moment_id,
    moment_source_fingerprint, moment_track_analysis_version, moment_track_analysis_audio_sha256,
    source_start_ms, source_end_ms,
    previous_start_ms, previous_end_ms, effective_start_ms, effective_end_ms,
    judgment, corrected_purpose, preferred_cut_seconds,
    preferred_moment_id, preferred_moment_source_fingerprint,
    evidence, created_by
  ) values (
    v_moment.owner_id, v_moment.artist_id, v_moment.release_id, v_moment.track_id, v_moment.id,
    v_moment.source_fingerprint, v_moment.track_analysis_version, v_moment.track_analysis_audio_sha256,
    v_moment.source_start_ms, v_moment.source_end_ms,
    v_moment.start_ms, v_moment.end_ms, p_start_ms, p_end_ms,
    p_judgment,
    nullif(btrim(coalesce(p_corrected_purpose, '')), ''),
    p_preferred_cut_seconds,
    p_preferred_moment_id,
    case when p_preferred_moment_id is null then null else v_preferred.source_fingerprint end,
    p_evidence,
    v_user_id
  ) returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.review_moment_with_calibration(uuid,uuid,text,integer,integer,text,public.moment_calibration_judgment,text,integer,uuid,jsonb) from public, anon;
grant execute on function public.review_moment_with_calibration(uuid,uuid,text,integer,integer,text,public.moment_calibration_judgment,text,integer,uuid,jsonb) to authenticated;

-- Preserve the existing verified-performance learning channel and add explicit calibration as a
-- separate bounded rank-only signal. Neither channel can alter canonical musical timing or analysis.
create or replace function private.moment_execution_score(
  p_moment_id uuid,
  p_platform text,
  p_format text,
  p_goal text
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select m.*
    from public.moments m
    where m.id = p_moment_id
  ), active_effects as (
    select
      ml.confidence as learning_confidence,
      ml.effect,
      case ml.effect ->> 'trait'
        when 'vocal_score' then t.vocal_score
        when 'hook_score' then t.hook_score
        when 'emotional_score' then t.emotional_score
        when 'energy_score' then t.energy_score
        when 'uniqueness_score' then t.uniqueness_score
        else null
      end as trait_score
    from target t
    join public.marketing_learnings ml
      on ml.artist_id = t.artist_id
     and ml.status = 'approved'
     and ml.effect_version = 1
     and ml.effect <> '{}'::jsonb
     and private.is_valid_marketing_learning_effect(ml.effect)
     and (ml.expires_at is null or ml.expires_at > now())
     and (not (ml.effect ? 'platform') or lower(ml.effect ->> 'platform') = lower(coalesce(p_platform, '')))
     and (not (ml.effect ? 'format') or lower(ml.effect ->> 'format') = lower(coalesce(p_format, '')))
     and (not (ml.effect ? 'goal') or lower(ml.effect ->> 'goal') = lower(coalesce(p_goal, '')))
  ), effect_boost as (
    select least(
      0.30::numeric,
      coalesce(sum(
        (effect ->> 'weight')::numeric
        * learning_confidence
        * case effect ->> 'direction'
            when 'higher' then greatest(0::numeric, least(1::numeric, coalesce(trait_score, 0)))
            when 'lower' then 1::numeric - greatest(0::numeric, least(1::numeric, coalesce(trait_score, 0)))
            else 0::numeric
          end
      ), 0::numeric)
    ) as boost
    from active_effects
  ), calibration as (
    select private.moment_calibration_delta(p_moment_id) as delta
  )
  select
    0.50::numeric * t.confidence
    + 0.18::numeric * coalesce(t.hook_score, 0)
    + 0.10::numeric * coalesce(t.vocal_score, 0)
    + 0.08::numeric * coalesce(t.emotional_score, 0)
    + 0.07::numeric * coalesce(t.energy_score, 0)
    + 0.07::numeric * coalesce(t.uniqueness_score, 0)
    + b.boost
    + c.delta
  from target t
  cross join effect_boost b
  cross join calibration c;
$$;

revoke all on function private.moment_execution_score(uuid, text, text, text) from public;

comment on function private.moment_calibration_delta(uuid) is
  'Uses only the latest calibration event whose full Moment/analyzer/master provenance still matches. Explicit artist judgment contributes at most +/-0.20 to ranking.';
comment on function public.review_moment_with_calibration(uuid,uuid,text,integer,integer,text,public.moment_calibration_judgment,text,integer,uuid,jsonb) is
  'Atomic Moment review plus append-only calibration snapshot. Source intelligence and immutable source timing are never modified.';
