-- Ensemblis #71: service-role campaign AI spend must remain inside one artist.
-- Keep the original owner-scoped RPCs for rollout compatibility, but core Ensemblis callers use
-- these artist-scoped wrappers. Each wrapper proves lineage before delegating to the atomic legacy
-- accounting function, so a service-role worker cannot settle/release a sibling artist reservation.

create or replace function public.reserve_campaign_ai_spend_for_artist(
  p_owner_id uuid,
  p_artist_id uuid,
  p_campaign_id uuid,
  p_generation_run_id uuid,
  p_media_kind text,
  p_amount_usd numeric
)
returns public.campaign_ai_spend_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  campaign_artist uuid;
  generation_artist uuid;
  result public.campaign_ai_spend_reservations%rowtype;
begin
  perform private.assert_operational_artist_owner(p_owner_id, p_artist_id);

  select c.artist_id into campaign_artist
  from public.campaigns c
  where c.id = p_campaign_id and c.owner_id = p_owner_id;
  if campaign_artist is null or campaign_artist <> p_artist_id then
    raise exception 'Campaign AI spend campaign does not belong to the requested artist.';
  end if;

  select g.artist_id into generation_artist
  from public.generation_runs g
  where g.id = p_generation_run_id
    and g.owner_id = p_owner_id
    and g.campaign_id = p_campaign_id;
  if generation_artist is null or generation_artist <> p_artist_id then
    raise exception 'Campaign AI spend generation does not belong to the requested artist/campaign.';
  end if;

  select * into result
  from public.reserve_campaign_ai_spend(
    p_owner_id,
    p_campaign_id,
    p_generation_run_id,
    p_media_kind,
    p_amount_usd
  );

  if result.artist_id <> p_artist_id then
    raise exception 'Campaign AI spend reservation resolved to a different artist.';
  end if;
  return result;
end;
$$;

create or replace function public.settle_campaign_ai_spend_for_artist(
  p_owner_id uuid,
  p_artist_id uuid,
  p_reservation_id uuid,
  p_actual_usd numeric,
  p_basis text default 'estimated'
)
returns public.campaign_ai_spend_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_artist uuid;
  result public.campaign_ai_spend_reservations%rowtype;
begin
  perform private.assert_operational_artist_owner(p_owner_id, p_artist_id);
  select r.artist_id into reservation_artist
  from public.campaign_ai_spend_reservations r
  where r.id = p_reservation_id and r.owner_id = p_owner_id;
  if reservation_artist is null or reservation_artist <> p_artist_id then
    raise exception 'Campaign AI spend reservation does not belong to the requested artist.';
  end if;

  select * into result
  from public.settle_campaign_ai_spend(p_owner_id, p_reservation_id, p_actual_usd, p_basis);
  if result.artist_id <> p_artist_id then
    raise exception 'Settled campaign AI spend resolved to a different artist.';
  end if;
  return result;
end;
$$;

create or replace function public.release_campaign_ai_spend_for_artist(
  p_owner_id uuid,
  p_artist_id uuid,
  p_reservation_id uuid,
  p_reason text default 'not_billed'
)
returns public.campaign_ai_spend_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_artist uuid;
  result public.campaign_ai_spend_reservations%rowtype;
begin
  perform private.assert_operational_artist_owner(p_owner_id, p_artist_id);
  select r.artist_id into reservation_artist
  from public.campaign_ai_spend_reservations r
  where r.id = p_reservation_id and r.owner_id = p_owner_id;
  if reservation_artist is null or reservation_artist <> p_artist_id then
    raise exception 'Campaign AI spend reservation does not belong to the requested artist.';
  end if;

  select * into result
  from public.release_campaign_ai_spend(p_owner_id, p_reservation_id, p_reason);
  if result.artist_id <> p_artist_id then
    raise exception 'Released campaign AI spend resolved to a different artist.';
  end if;
  return result;
end;
$$;

revoke all on function public.reserve_campaign_ai_spend_for_artist(uuid,uuid,uuid,uuid,text,numeric) from public, anon, authenticated;
revoke all on function public.settle_campaign_ai_spend_for_artist(uuid,uuid,uuid,numeric,text) from public, anon, authenticated;
revoke all on function public.release_campaign_ai_spend_for_artist(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_campaign_ai_spend_for_artist(uuid,uuid,uuid,uuid,text,numeric) to service_role;
grant execute on function public.settle_campaign_ai_spend_for_artist(uuid,uuid,uuid,numeric,text) to service_role;
grant execute on function public.release_campaign_ai_spend_for_artist(uuid,uuid,uuid,text) to service_role;
