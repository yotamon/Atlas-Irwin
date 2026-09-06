-- Allow the canonical Growth opportunity queue to represent consent-safe owned-audience work.
-- This remains internal preparation only; it does not grant communication permission or send messages.

alter table public.growth_opportunities
  drop constraint if exists growth_opportunities_kind_check;

alter table public.growth_opportunities
  add constraint growth_opportunities_kind_check check (kind in (
    'catalog_revival','content_breakout','release_risk','funnel_bottleneck','release_candidate',
    'scene_fit','outreach_target','gig_fit','label_fit','playlist_fit','channel_fit','owned_audience'
  ));

comment on constraint growth_opportunities_kind_check on public.growth_opportunities is
  'Canonical artist Growth opportunity kinds, including consent-safe owned-audience preparation.';
