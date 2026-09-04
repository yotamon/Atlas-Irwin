-- Ensemblis closed-loop learning: evolve the canonical learning store and
-- expose only explicit Moment -> content -> metric lineage as auto-learning evidence.

alter table public.marketing_learnings
  add column if not exists learning_key text,
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
  add constraint marketing_learnings_effect_version_check
    check (effect_version = 1),
  add constraint marketing_learnings_evidence_sample_size_check
    check (evidence_sample_size >= 0),
  add constraint marketing_learnings_evidence_window_check
    check (evidence_window_end is null or evidence_window_start is null or evidence_window_end >= evidence_window_start),
  add constraint marketing_learnings_expiry_check
    check (expires_at is null or last_evidence_at is null or expires_at >= last_evidence_at);

create unique index if not exists marketing_learnings_artist_learning_key_idx
  on public.marketing_learnings(artist_id, learning_key)
  where learning_key is not null;

create index if not exists marketing_learnings_active_effect_idx
  on public.marketing_learnings(artist_id, status, expires_at)
  where status = 'approved';

comment on column public.marketing_learnings.learning_key is
  'Stable artist-scoped idempotency key for deterministic learning proposals.';
comment on column public.marketing_learnings.effect is
  'Versioned, whitelisted structured effect consumed by ranking/planning. Human-readable finding text is never executed directly.';
comment on column public.marketing_learnings.expires_at is
  'After this instant an approved learning remains historical but may no longer influence future decisions.';

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
  m.purpose_tags,
  m.confidence as moment_confidence,
  ms.source as metric_source,
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
  'Strict evidence boundary for automatic learning. Requires explicit content_item_id and approved Moment lineage; manual snapshots and inferred campaign context are intentionally insufficient.';

grant select on public.verified_moment_learning_evidence to authenticated;
