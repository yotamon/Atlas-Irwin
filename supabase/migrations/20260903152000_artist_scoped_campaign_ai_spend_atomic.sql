-- Ensemblis #71: artist-aware campaign AI spend must be atomic and must not delegate
-- authorization/accounting to the legacy owner-canonical RPCs. The legacy RPCs remain for
-- rollout compatibility, but every Ensemblis caller uses these functions.

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
  envelope_row public.campaign_ai_spend_envelopes%rowtype;
  existing_row public.campaign_ai_spend_reservations%rowtype;
  reservation_row public.campaign_ai_spend_reservations%rowtype;
  generation_artist uuid;
begin
  perform private.assert_operational_artist_owner(p_owner_id, p_artist_id);

  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'Campaign AI spend reservation must be positive.';
  end if;
  if p_media_kind not in ('image', 'video') then
    raise exception 'Unsupported campaign AI media kind: %', p_media_kind;
  end if;

  select r.* into existing_row
  from public.campaign_ai_spend_reservations r
  where r.owner_id = p_owner_id
    and r.artist_id = p_artist_id
    and r.generation_run_id = p_generation_run_id
  limit 1;
  if found then
    return existing_row;
  end if;

  select g.artist_id into generation_artist
  from public.generation_runs g
  where g.id = p_generation_run_id
    and g.owner_id = p_owner_id
    and g.artist_id = p_artist_id
    and g.campaign_id = p_campaign_id;
  if generation_artist is null then
    raise exception 'Campaign AI spend generation does not belong to the requested artist/campaign.';
  end if;

  select e.* into envelope_row
  from public.campaign_ai_spend_envelopes e
  join public.campaigns c
    on c.id = e.campaign_id
   and c.owner_id = e.owner_id
   and c.artist_id = e.artist_id
  where e.owner_id = p_owner_id
    and e.artist_id = p_artist_id
    and e.campaign_id = p_campaign_id
    and c.mode = 'autopilot'
  for update of e;

  if not found then
    raise exception 'Autonomous AI spend requires an autopilot campaign with a configured artist envelope.';
  end if;
  if not envelope_row.enabled then
    raise exception 'Campaign AI spend envelope is disabled.';
  end if;
  if envelope_row.expires_at is not null and envelope_row.expires_at <= now() then
    raise exception 'Campaign AI spend envelope has expired.';
  end if;
  if envelope_row.overrun_usd > 0 then
    raise exception 'Campaign AI spend is paused because a provider exceeded a prior reservation by $%.', envelope_row.overrun_usd;
  end if;
  if not p_media_kind = any(envelope_row.allowed_media_kinds) then
    raise exception 'Campaign AI spend envelope does not allow % generation.', p_media_kind;
  end if;
  if envelope_row.max_single_generation_usd <= 0
     or p_amount_usd > envelope_row.max_single_generation_usd + 0.0001 then
    raise exception 'Generation reservation $% exceeds campaign per-generation ceiling $%.', p_amount_usd, envelope_row.max_single_generation_usd;
  end if;
  if envelope_row.reserved_usd + envelope_row.spent_usd + p_amount_usd > envelope_row.hard_limit_usd + 0.0001 then
    raise exception 'Generation reservation would exceed campaign AI hard limit.';
  end if;

  insert into public.campaign_ai_spend_reservations (
    owner_id,
    artist_id,
    campaign_id,
    envelope_id,
    generation_run_id,
    media_kind,
    reserved_usd
  ) values (
    p_owner_id,
    p_artist_id,
    p_campaign_id,
    envelope_row.id,
    p_generation_run_id,
    p_media_kind,
    round(p_amount_usd, 4)
  ) returning * into reservation_row;

  update public.campaign_ai_spend_envelopes
  set reserved_usd = reserved_usd + reservation_row.reserved_usd
  where id = envelope_row.id
    and owner_id = p_owner_id
    and artist_id = p_artist_id;

  return reservation_row;
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
  reservation_row public.campaign_ai_spend_reservations%rowtype;
  actual numeric;
  overrun numeric;
  basis text;
begin
  perform private.assert_operational_artist_owner(p_owner_id, p_artist_id);

  if p_basis not in ('provider_actual', 'estimated', 'conservative_reserve', 'not_billed') then
    raise exception 'Unsupported campaign AI spend settlement basis.';
  end if;

  select r.* into reservation_row
  from public.campaign_ai_spend_reservations r
  where r.id = p_reservation_id
    and r.owner_id = p_owner_id
    and r.artist_id = p_artist_id
  for update;
  if not found then
    raise exception 'Campaign AI spend reservation does not belong to the requested artist.';
  end if;
  if reservation_row.status <> 'reserved' then
    return reservation_row;
  end if;

  actual := greatest(0, round(coalesce(p_actual_usd, reservation_row.reserved_usd), 4));
  overrun := greatest(0, actual - reservation_row.reserved_usd);
  basis := case when overrun > 0 then 'provider_actual' else p_basis end;

  update public.campaign_ai_spend_envelopes
  set reserved_usd = greatest(0, reserved_usd - reservation_row.reserved_usd),
      spent_usd = spent_usd + actual,
      overrun_usd = overrun_usd + overrun
  where id = reservation_row.envelope_id
    and owner_id = p_owner_id
    and artist_id = p_artist_id;

  update public.campaign_ai_spend_reservations
  set status = 'settled',
      settled_usd = actual,
      settlement_basis = basis,
      settled_at = now(),
      released_reason = null
  where id = reservation_row.id
    and owner_id = p_owner_id
    and artist_id = p_artist_id
  returning * into reservation_row;

  return reservation_row;
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
  reservation_row public.campaign_ai_spend_reservations%rowtype;
begin
  perform private.assert_operational_artist_owner(p_owner_id, p_artist_id);

  select r.* into reservation_row
  from public.campaign_ai_spend_reservations r
  where r.id = p_reservation_id
    and r.owner_id = p_owner_id
    and r.artist_id = p_artist_id
  for update;
  if not found then
    raise exception 'Campaign AI spend reservation does not belong to the requested artist.';
  end if;
  if reservation_row.status <> 'reserved' then
    return reservation_row;
  end if;

  update public.campaign_ai_spend_envelopes
  set reserved_usd = greatest(0, reserved_usd - reservation_row.reserved_usd)
  where id = reservation_row.envelope_id
    and owner_id = p_owner_id
    and artist_id = p_artist_id;

  update public.campaign_ai_spend_reservations
  set status = 'released',
      settled_usd = 0,
      settlement_basis = 'not_billed',
      released_reason = left(coalesce(p_reason, 'not_billed'), 500),
      settled_at = now()
  where id = reservation_row.id
    and owner_id = p_owner_id
    and artist_id = p_artist_id
  returning * into reservation_row;

  return reservation_row;
end;
$$;

revoke all on function public.reserve_campaign_ai_spend_for_artist(uuid,uuid,uuid,uuid,text,numeric) from public, anon, authenticated;
revoke all on function public.settle_campaign_ai_spend_for_artist(uuid,uuid,uuid,numeric,text) from public, anon, authenticated;
revoke all on function public.release_campaign_ai_spend_for_artist(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_campaign_ai_spend_for_artist(uuid,uuid,uuid,uuid,text,numeric) to service_role;
grant execute on function public.settle_campaign_ai_spend_for_artist(uuid,uuid,uuid,numeric,text) to service_role;
grant execute on function public.release_campaign_ai_spend_for_artist(uuid,uuid,uuid,text) to service_role;
