-- Product-quality readback for the first useful Ensemblis loop.
-- This view measures elapsed time between observed milestones without becoming onboarding state.

create or replace view public.artist_activation_readback
with (security_invoker = true)
as
select
  artist.owner_id,
  artist.artist_id,
  min(artist.occurred_at) filter (where artist.event_type = 'onboarding_started') as onboarding_started_at,
  min(artist.occurred_at) filter (where artist.event_type = 'artist_identity_confirmed') as identity_confirmed_at,
  min(artist.occurred_at) filter (where artist.event_type = 'first_music_added') as first_music_at,
  min(artist.occurred_at) filter (where artist.event_type = 'first_intelligence_ready') as first_intelligence_at,
  min(artist.occurred_at) filter (where artist.event_type = 'first_release_mission') as first_release_mission_at,
  min(artist.occurred_at) filter (where artist.event_type = 'first_moment_curated') as first_moment_curated_at,
  min(artist.occurred_at) filter (where artist.event_type = 'first_moment_approved') as first_moment_approved_at,
  min(artist.occurred_at) filter (where artist.event_type = 'first_useful_recommendation') as first_useful_recommendation_at,
  min(artist.occurred_at) filter (where artist.event_type = 'onboarding_dismissed') as onboarding_dismissed_at,
  case
    when min(artist.occurred_at) filter (where artist.event_type = 'onboarding_started') is not null
     and min(artist.occurred_at) filter (where artist.event_type = 'first_useful_recommendation') is not null
    then extract(epoch from (
      min(artist.occurred_at) filter (where artist.event_type = 'first_useful_recommendation')
      - min(artist.occurred_at) filter (where artist.event_type = 'onboarding_started')
    )) / 60.0
    else null
  end as minutes_to_first_useful_recommendation,
  case
    when min(artist.occurred_at) filter (where artist.event_type = 'first_moment_approved') is not null then 'activated'
    when min(artist.occurred_at) filter (where artist.event_type = 'onboarding_dismissed') is not null then 'dismissed'
    when min(artist.occurred_at) filter (where artist.event_type = 'onboarding_started') is not null then 'in_progress'
    else 'not_started'
  end as activation_state
from public.artist_activation_events artist
group by artist.owner_id, artist.artist_id;

grant select on public.artist_activation_readback to authenticated, service_role;

comment on view public.artist_activation_readback is
  'Security-invoker quality readback for first-use activation. Milestone timestamps are observations; canonical Music, Release and Moment state remains authoritative.';