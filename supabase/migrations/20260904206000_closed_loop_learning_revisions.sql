-- Ensemblis #50 learning revision semantics
--
-- learning_key is idempotent for the current proposal, not a permanent global
-- identity. Historical approved/rejected/superseded revisions may retain the same
-- deterministic key. This lets fresh evidence propose the same direction again
-- after an approved rule expires without rewriting the prior approval record.

drop index if exists public.marketing_learnings_artist_learning_key_idx;
create unique index marketing_learnings_artist_learning_key_idx
  on public.marketing_learnings(artist_id, learning_key)
  where learning_key is not null and status = 'proposed';

comment on column public.marketing_learnings.learning_key is
  'Stable artist-scoped idempotency key for the current proposal. Historical revisions may share the key; only one proposed revision may exist at a time.';

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
    select
      c.*,
      'moment-trait:v1:' || lower(c.platform) || ':' || c.trait || ':' || c.metric as family_key,
      'moment-trait:v1:' || lower(c.platform) || ':' || c.trait || ':' || c.metric || ':' || c.direction as proposal_key
    from candidates c
    where c.relative_lift >= 0.20
  ), actionable as (
    select q.*
    from qualified q
    where not exists (
      select 1
      from public.marketing_learnings active
      where active.artist_id = p_artist_id
        and active.learning_family_key = q.family_key
        and active.status = 'approved'
        and (active.expires_at is null or active.expires_at > now())
        and active.effect ->> 'kind' = 'moment_trait_preference'
        and active.effect ->> 'direction' = q.direction
    )
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
        'trustBoundary', 'published_object_provider_metric'
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
      q.proposal_key,
      q.family_key,
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
    from actionable q
    on conflict (artist_id, learning_key) where learning_key is not null and status = 'proposed'
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
    returning id
  )
  select count(*)::integer into v_changed from upserted;

  return coalesce(v_changed, 0);
end;
$$;

revoke all on function private.refresh_moment_performance_learnings(uuid, uuid) from public;

comment on function private.refresh_moment_performance_learnings(uuid, uuid) is
  'Refreshes only current proposals from verified published-object evidence. Active approved rules suppress same-direction duplicates; expired approvals can produce a fresh immutable revision for review.';
