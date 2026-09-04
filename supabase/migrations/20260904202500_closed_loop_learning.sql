-- Ensemblis closed-loop learning
--
-- This migration closes the trustworthy path from an approved musical Moment to
-- generated content, observed provider outcomes, a reviewable learning, and the
-- next Moment decision. Free-form finding text is deliberately non-executable.

alter table public.marketing_learnings
  add column if not exists learning_key text,
  add column if not exists learning_family_key text,
  add column if not exists effect_version integer not null default 1,
  add column if not exists effect jsonb not null default '{}'::jsonb,
  add column if not exists evidence_sample_size integer not null default 0,
  add column if not exists evidence_window_start timestamptz,
  add column if not exists evidence_window_end timestamptz,
  add column if not exists last_evidence_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists supersedes_learning_id uuid references public.marketing_learnings(id) on delete set null;

alter table public.marketing_learnings
  drop constraint if exists marketing_learnings_scope_check,
  add constraint marketing_learnings_scope_check
    check (scope in ('brand','platform','audience','campaign','release','experiment','content','moment','track','format')),
  drop constraint if exists marketing_learnings_source_check,
  add constraint marketing_learnings_source_check
    check (source in ('analysis','manual','experiment','import','performance')),
  drop constraint if exists marketing_learnings_effect_version_check,
  add constraint marketing_learnings_effect_version_check
    check (effect_version = 1),
  drop constraint if exists marketing_learnings_evidence_sample_size_check,
  add constraint marketing_learnings_evidence_sample_size_check
    check (evidence_sample_size >= 0),
  drop constraint if exists marketing_learnings_evidence_window_check,
  add constraint marketing_learnings_evidence_window_check
    check (evidence_window_end is null or evidence_window_start is null or evidence_window_end >= evidence_window_start),
  drop constraint if exists marketing_learnings_expiry_check,
  add constraint marketing_learnings_expiry_check
    check (expires_at is null or last_evidence_at is null or expires_at >= last_evidence_at);

create unique index if not exists marketing_learnings_artist_learning_key_idx
  on public.marketing_learnings(artist_id, learning_key)
  where learning_key is not null;

create index if not exists marketing_learnings_active_effect_idx
  on public.marketing_learnings(artist_id, status, expires_at)
  where status = 'approved';

create index if not exists marketing_learnings_family_idx
  on public.marketing_learnings(artist_id, learning_family_key, status)
  where learning_family_key is not null;

comment on column public.marketing_learnings.learning_key is
  'Stable artist-scoped idempotency key for deterministic learning proposals.';
comment on column public.marketing_learnings.learning_family_key is
  'Groups mutually exclusive learning directions so a newly approved conclusion can supersede an older one.';
comment on column public.marketing_learnings.effect is
  'Versioned, whitelisted structured effect consumed by ranking/planning. Human-readable finding text is never executed directly.';
comment on column public.marketing_learnings.expires_at is
  'After this instant an approved learning remains historical but may no longer influence future decisions.';

-- Moment-selected content is a first-class timestamp provenance source. Generated
-- content receives the exact approved Moment window before the older generic music
-- intelligence trigger has an opportunity to choose another cut.
alter table public.content_items
  drop constraint if exists content_items_audio_timestamp_source_check,
  add constraint content_items_audio_timestamp_source_check
    check (audio_timestamp_source in ('manual','music_intelligence','moment'));

create or replace function private.is_valid_marketing_learning_effect(p_effect jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_weight numeric;
begin
  if p_effect is null or p_effect = '{}'::jsonb then
    return true;
  end if;
  if jsonb_typeof(p_effect) <> 'object' then
    return false;
  end if;

  for v_key in select jsonb_object_keys(p_effect)
  loop
    if v_key not in ('kind','trait','direction','weight','platform','format','goal','metric') then
      return false;
    end if;
  end loop;

  if p_effect ->> 'kind' <> 'moment_trait_preference' then
    return false;
  end if;
  if p_effect ->> 'trait' not in ('vocal_score','hook_score','emotional_score','energy_score','uniqueness_score') then
    return false;
  end if;
  if p_effect ->> 'direction' not in ('higher','lower') then
    return false;
  end if;
  if p_effect ->> 'metric' not in ('save_rate','follow_rate','click_rate','engagement_rate') then
    return false;
  end if;
  if jsonb_typeof(p_effect -> 'weight') <> 'number' then
    return false;
  end if;
  v_weight := (p_effect ->> 'weight')::numeric;
  if v_weight < 0 or v_weight > 0.30 then
    return false;
  end if;
  if p_effect ? 'platform' and jsonb_typeof(p_effect -> 'platform') <> 'string' then
    return false;
  end if;
  if p_effect ? 'format' and jsonb_typeof(p_effect -> 'format') <> 'string' then
    return false;
  end if;
  if p_effect ? 'goal' and jsonb_typeof(p_effect -> 'goal') <> 'string' then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

alter table public.marketing_learnings
  drop constraint if exists marketing_learnings_effect_check,
  add constraint marketing_learnings_effect_check
    check (private.is_valid_marketing_learning_effect(effect));

create or replace function private.guard_marketing_learning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_id uuid;
begin
  if not private.is_valid_marketing_learning_effect(new.effect) then
    raise exception 'Learning effect is not a supported Ensemblis decision contract';
  end if;

  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if new.effect <> '{}'::jsonb and new.expires_at is not null and new.expires_at <= now() then
      raise exception 'Expired learning evidence cannot become an active decision rule';
    end if;

    if new.learning_family_key is not null then
      select ml.id
        into v_previous_id
      from public.marketing_learnings ml
      where ml.artist_id = new.artist_id
        and ml.learning_family_key = new.learning_family_key
        and ml.status = 'approved'
        and ml.id <> new.id
      order by ml.approved_at desc nulls last, ml.created_at desc
      limit 1;

      if v_previous_id is not null then
        update public.marketing_learnings
        set status = 'superseded', updated_at = now()
        where id = v_previous_id;
        new.supersedes_learning_id := coalesce(new.supersedes_learning_id, v_previous_id);
      end if;
    end if;

    new.approved_at := coalesce(new.approved_at, now());
  elsif new.status <> 'approved' and tg_op = 'UPDATE' and old.status = 'approved' then
    new.approved_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists marketing_learnings_guard_decision_contract on public.marketing_learnings;
create trigger marketing_learnings_guard_decision_contract
before insert or update on public.marketing_learnings
for each row execute function private.guard_marketing_learning();

create or replace view public.verified_moment_learning_evidence
with (security_invoker = true)
as
select
  ms.id as metric_snapshot_id,
  ms.owner_id,
  ms.artist_id,
  ms.content_item_id,
  ci.moment_id,
  m.track_id,
  m.release_id,
  ci.campaign_id,
  ci.platform::text as platform,
  ci.format,
  ci.goal,
  m.moment_type,
  m.label as moment_label,
  m.source_mode::text as source_mode,
  m.purpose_tags,
  m.confidence as moment_confidence,
  m.vocal_score,
  m.hook_score,
  m.emotional_score,
  m.energy_score,
  m.uniqueness_score,
  ms.source as metric_source,
  ms.external_object_id,
  ms.captured_at,
  ms.date,
  ms.reach,
  ms.views,
  ms.watch_time,
  ms.likes,
  ms.comments,
  ms.shares,
  ms.saves,
  ms.profile_visits,
  ms.follows,
  ms.link_clicks,
  ms.streams,
  ms.listeners,
  ms.playlist_adds
from public.metric_snapshots ms
join public.content_items ci
  on ci.id = ms.content_item_id
join public.moments m
  on m.id = ci.moment_id
where ms.content_item_id is not null
  and ci.moment_id is not null
  and ms.source <> 'manual'
  and ms.external_object_id is not null
  and btrim(ms.external_object_id) <> ''
  and ms.owner_id = ci.owner_id
  and ci.owner_id = m.owner_id
  and ms.artist_id = ci.artist_id
  and ci.artist_id = m.artist_id
  and ci.release_id = m.release_id
  and (ms.release_id is null or ms.release_id = ci.release_id)
  and ms.platform = ci.platform
  and m.state = 'approved'
  and m.superseded_by_id is null;

comment on view public.verified_moment_learning_evidence is
  'Strict evidence boundary for automatic learning. Requires provider-backed metrics plus explicit content_item_id and approved Moment lineage; manual snapshots and inferred campaign context are intentionally insufficient.';

grant select on public.verified_moment_learning_evidence to authenticated;

-- Only the latest cumulative provider snapshot for a content item is used by the
-- learner. This avoids counting the same views/saves repeatedly across snapshots.
create or replace function private.refresh_moment_performance_learnings(
  p_owner_id uuid,
  p_artist_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer := 0;
begin
  with latest as (
    select distinct on (e.content_item_id)
      e.*,
      greatest(e.views, e.reach, 0)::numeric as qualified_sample
    from public.verified_moment_learning_evidence e
    where e.owner_id = p_owner_id
      and e.artist_id = p_artist_id
      and e.captured_at >= now() - interval '90 days'
    order by e.content_item_id, e.captured_at desc, e.metric_snapshot_id desc
  ), trait_rows as (
    select
      l.*,
      trait.trait,
      trait.score,
      case when trait.score >= 0.65 then 'higher'
           when trait.score <= 0.35 then 'lower'
           else null end as cohort
    from latest l
    cross join lateral (values
      ('vocal_score'::text, l.vocal_score),
      ('hook_score'::text, l.hook_score),
      ('emotional_score'::text, l.emotional_score),
      ('energy_score'::text, l.energy_score),
      ('uniqueness_score'::text, l.uniqueness_score)
    ) trait(trait, score)
    where trait.score is not null
      and l.qualified_sample >= 100
  ), metric_rows as (
    select
      t.*,
      metric.metric,
      metric.numerator
    from trait_rows t
    cross join lateral (values
      ('save_rate'::text, t.saves::numeric),
      ('follow_rate'::text, t.follows::numeric),
      ('click_rate'::text, t.link_clicks::numeric),
      ('engagement_rate'::text, (t.likes + t.comments + t.shares + t.saves)::numeric)
    ) metric(metric, numerator)
    where t.cohort is not null
  ), cohorts as (
    select
      platform,
      trait,
      metric,
      cohort,
      count(distinct content_item_id)::integer as content_items,
      count(distinct moment_id)::integer as moments,
      sum(qualified_sample)::numeric as sample,
      sum(numerator)::numeric as numerator,
      min(captured_at) as evidence_start,
      max(captured_at) as evidence_end
    from metric_rows
    group by platform, trait, metric, cohort
    having count(distinct content_item_id) >= 2
       and sum(qualified_sample) >= 500
  ), comparisons as (
    select
      hi.platform,
      hi.trait,
      hi.metric,
      hi.content_items as high_content_items,
      lo.content_items as low_content_items,
      hi.moments as high_moments,
      lo.moments as low_moments,
      hi.sample as high_sample,
      lo.sample as low_sample,
      hi.numerator / nullif(hi.sample, 0) as high_rate,
      lo.numerator / nullif(lo.sample, 0) as low_rate,
      least(hi.evidence_start, lo.evidence_start) as evidence_start,
      greatest(hi.evidence_end, lo.evidence_end) as evidence_end
    from cohorts hi
    join cohorts lo
      on lo.platform = hi.platform
     and lo.trait = hi.trait
     and lo.metric = hi.metric
     and lo.cohort = 'lower'
    where hi.cohort = 'higher'
  ), candidates as (
    select
      c.*,
      case when c.high_rate >= c.low_rate then 'higher' else 'lower' end as direction,
      abs(c.high_rate - c.low_rate) /
        greatest(least(c.high_rate, c.low_rate), 0.001::numeric) as relative_lift,
      (c.high_sample + c.low_sample)::integer as total_sample,
      (c.high_content_items + c.low_content_items)::integer as total_content_items
    from comparisons c
    where greatest(c.high_rate, c.low_rate) > 0
  ), qualified as (
    select *
    from candidates
    where relative_lift >= 0.20
  ), upserted as (
    insert into public.marketing_learnings (
      owner_id,
      artist_id,
      scope,
      finding,
      evidence,
      confidence,
      status,
      applies_to,
      source,
      learning_key,
      learning_family_key,
      effect_version,
      effect,
      evidence_sample_size,
      evidence_window_start,
      evidence_window_end,
      last_evidence_at,
      expires_at
    )
    select
      p_owner_id,
      p_artist_id,
      'moment',
      case q.direction
        when 'higher' then 'On ' || q.platform || ', Moments with higher ' || replace(q.trait, '_score', '') || ' signal produced a stronger ' || replace(q.metric, '_', ' ') || ' in verified content.'
        else 'On ' || q.platform || ', Moments with lower ' || replace(q.trait, '_score', '') || ' signal produced a stronger ' || replace(q.metric, '_', ' ') || ' in verified content.'
      end,
      jsonb_build_object(
        'metric', q.metric,
        'platform', q.platform,
        'relativeLift', round(q.relative_lift, 4),
        'high', jsonb_build_object(
          'rate', round(q.high_rate, 6),
          'sample', q.high_sample::integer,
          'contentItems', q.high_content_items,
          'moments', q.high_moments
        ),
        'low', jsonb_build_object(
          'rate', round(q.low_rate, 6),
          'sample', q.low_sample::integer,
          'contentItems', q.low_content_items,
          'moments', q.low_moments
        ),
        'trustBoundary', 'explicit_moment_content_provider_metric'
      ),
      least(
        0.95::numeric,
        0.55::numeric
          + least(q.relative_lift, 1::numeric) * 0.20::numeric
          + least(q.total_sample::numeric / 10000::numeric, 1::numeric) * 0.15::numeric
          + least(q.total_content_items::numeric / 10::numeric, 1::numeric) * 0.05::numeric
      ),
      'proposed',
      jsonb_build_object('platform', q.platform, 'trait', q.trait, 'metric', q.metric),
      'performance',
      'moment-trait:v1:' || lower(q.platform) || ':' || q.trait || ':' || q.metric || ':' || q.direction,
      'moment-trait:v1:' || lower(q.platform) || ':' || q.trait || ':' || q.metric,
      1,
      jsonb_build_object(
        'kind', 'moment_trait_preference',
        'trait', q.trait,
        'direction', q.direction,
        'weight', least(0.30::numeric, 0.08::numeric + least(q.relative_lift, 1::numeric) * 0.12::numeric),
        'platform', q.platform,
        'metric', q.metric
      ),
      q.total_sample,
      q.evidence_start,
      q.evidence_end,
      q.evidence_end,
      q.evidence_end + interval '90 days'
    from qualified q
    on conflict (artist_id, learning_key) where learning_key is not null
    do update set
      finding = excluded.finding,
      evidence = excluded.evidence,
      confidence = excluded.confidence,
      applies_to = excluded.applies_to,
      effect = excluded.effect,
      evidence_sample_size = excluded.evidence_sample_size,
      evidence_window_start = excluded.evidence_window_start,
      evidence_window_end = excluded.evidence_window_end,
      last_evidence_at = excluded.last_evidence_at,
      expires_at = excluded.expires_at,
      updated_at = now()
    where public.marketing_learnings.status in ('proposed','approved')
    returning id
  )
  select count(*)::integer into v_changed from upserted;

  return coalesce(v_changed, 0);
end;
$$;

revoke all on function private.refresh_moment_performance_learnings(uuid, uuid) from public;

create or replace function private.refresh_moment_learning_after_metric()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.content_item_id is not null
     and new.source <> 'manual'
     and new.external_object_id is not null
     and btrim(new.external_object_id) <> '' then
    perform private.refresh_moment_performance_learnings(new.owner_id, new.artist_id);
  end if;
  return new;
end;
$$;

drop trigger if exists metric_snapshots_refresh_moment_learning on public.metric_snapshots;
create trigger metric_snapshots_refresh_moment_learning
after insert or update of views,reach,likes,comments,shares,saves,follows,link_clicks,captured_at,external_object_id on public.metric_snapshots
for each row execute function private.refresh_moment_learning_after_metric();

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
  )
  select
    0.50::numeric * t.confidence
    + 0.18::numeric * coalesce(t.hook_score, 0)
    + 0.10::numeric * coalesce(t.vocal_score, 0)
    + 0.08::numeric * coalesce(t.emotional_score, 0)
    + 0.07::numeric * coalesce(t.energy_score, 0)
    + 0.07::numeric * coalesce(t.uniqueness_score, 0)
    + b.boost
  from target t
  cross join effect_boost b;
$$;

revoke all on function private.moment_execution_score(uuid, text, text, text) from public;

create or replace function private.attach_preferred_moment_to_generated_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moment public.moments%rowtype;
begin
  if new.moment_id is not null
     or new.release_id is null
     or new.artist_id is null
     or new.source not in ('planner','ai','automation') then
    return new;
  end if;

  select m.*
    into v_moment
  from public.moments m
  where m.owner_id = new.owner_id
    and m.artist_id = new.artist_id
    and m.release_id = new.release_id
    and m.state = 'approved'
    and m.superseded_by_id is null
  order by
    private.moment_execution_score(m.id, new.platform::text, new.format, new.goal) desc nulls last,
    m.confidence desc,
    m.created_at asc,
    m.id asc
  limit 1;

  if found then
    new.moment_id := v_moment.id;
    new.audio_timestamp_start := floor(v_moment.start_ms / 1000.0)::integer;
    new.audio_timestamp_end := ceil(v_moment.end_ms / 1000.0)::integer;
    new.audio_timestamp_source := 'moment';
    new.audio_timestamp_candidate_id := v_moment.source_candidate_id;
    new.audio_timestamp_analysis_version := v_moment.track_analysis_version;
  end if;

  return new;
end;
$$;

drop trigger if exists a0_attach_preferred_moment_to_generated_content on public.content_items;
create trigger a0_attach_preferred_moment_to_generated_content
before insert or update of release_id,artist_id,platform,format,goal,source,moment_id on public.content_items
for each row execute function private.attach_preferred_moment_to_generated_content();

create or replace function private.link_content_moment_to_campaign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if new.campaign_id is null or new.moment_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.campaign_moments cm
    where cm.campaign_id = new.campaign_id
      and cm.artist_id = new.artist_id
      and cm.is_active
  ) then
    v_role := 'supporting';
  else
    v_role := 'primary';
  end if;

  insert into public.campaign_moments(owner_id, artist_id, campaign_id, moment_id, role, is_active)
  values (new.owner_id, new.artist_id, new.campaign_id, new.moment_id, v_role, true)
  on conflict (campaign_id, moment_id)
  do update set is_active = true, updated_at = now();

  return new;
end;
$$;

drop trigger if exists content_items_link_moment_to_campaign on public.content_items;
create trigger content_items_link_moment_to_campaign
after insert or update of campaign_id,moment_id on public.content_items
for each row execute function private.link_content_moment_to_campaign();

comment on function private.moment_execution_score(uuid, text, text, text) is
  'Deterministic Moment ranking. Human-approved, unexpired, schema-valid learning effects can contribute at most 0.30 total boost; finding text is never evaluated.';
comment on function private.attach_preferred_moment_to_generated_content() is
  'For planner/AI/automation content only, chooses an approved artist/release Moment and snapshots its exact audio window before generic music-intelligence selection.';
