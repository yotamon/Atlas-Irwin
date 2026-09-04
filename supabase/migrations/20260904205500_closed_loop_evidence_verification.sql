-- Ensemblis #50 trusted provider evidence
--
-- A provider-looking source label plus an arbitrary external id is not sufficient
-- proof. Automatic learning only accepts metrics whose external object reconciles
-- to a durable published Ensemblis publication for the same artist/content/variant.

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
  ms.playlist_adds,
  ms.content_variant_id,
  coalesce(cv.creative_recipe_id, ci.creative_recipe_id) as creative_recipe_id,
  cr.recipe as creative_recipe
from public.metric_snapshots ms
join public.content_items ci on ci.id = ms.content_item_id
left join public.content_variants cv
  on cv.id = ms.content_variant_id and cv.content_item_id = ci.id
join public.moments m on m.id = ci.moment_id
left join public.creative_recipes cr
  on cr.id = coalesce(cv.creative_recipe_id, ci.creative_recipe_id)
 and cr.owner_id = ci.owner_id
 and cr.artist_id = ci.artist_id
 and cr.moment_id = ci.moment_id
where ms.content_item_id is not null
  and ci.moment_id is not null
  and ms.source <> 'manual'
  and ms.source <> 'attribution'
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
  and m.superseded_by_id is null
  and exists (
    select 1
    from public.publication_jobs pj
    where pj.owner_id = ms.owner_id
      and pj.artist_id = ms.artist_id
      and pj.status = 'published'
      and pj.platform = ms.platform::text
      and pj.external_post_id = ms.external_object_id
      and pj.content_item_id = ms.content_item_id
      and pj.content_variant_id is not distinct from ms.content_variant_id
  );

grant select on public.verified_moment_learning_evidence to authenticated;

create or replace view public.verified_creative_learning_evidence
with (security_invoker = true)
as
select e.*
from public.verified_moment_learning_evidence e
where e.creative_recipe_id is not null
  and e.creative_recipe is not null;

grant select on public.verified_creative_learning_evidence to authenticated;

comment on view public.verified_moment_learning_evidence is
  'Strict automatic-learning evidence: explicit approved Moment lineage plus provider metrics reconciled to the exact published Ensemblis content/variant object. Manual, first-party attribution, arbitrary provider labels and inferred campaign context are insufficient.';
comment on view public.verified_creative_learning_evidence is
  'Verified provider outcome evidence whose exact published content/variant resolves to both immutable musical Moment and creative-recipe causes.';
