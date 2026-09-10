create table public.campaign_ai_spend_envelopes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  enabled boolean not null default false,
  hard_limit_usd numeric(12,4) not null default 0 check (hard_limit_usd >= 0),
  max_single_generation_usd numeric(12,4) not null default 0 check (max_single_generation_usd >= 0),
  allowed_media_kinds text[] not null default array['image','video']::text[],
  reserved_usd numeric(12,4) not null default 0 check (reserved_usd >= 0),
  spent_usd numeric(12,4) not null default 0 check (spent_usd >= 0),
  overrun_usd numeric(12,4) not null default 0 check (overrun_usd >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, campaign_id),
  check (allowed_media_kinds <@ array['image','video']::text[]),
  check (cardinality(allowed_media_kinds) > 0),
  check (reserved_usd + spent_usd <= hard_limit_usd + overrun_usd + 0.0001)
);

create table public.campaign_ai_spend_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  envelope_id uuid not null references public.campaign_ai_spend_envelopes(id) on delete cascade,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  media_kind text not null check (media_kind in ('image','video')),
  reserved_usd numeric(12,4) not null check (reserved_usd > 0),
  settled_usd numeric(12,4),
  settlement_basis text check (settlement_basis in ('provider_actual','estimated','conservative_reserve','not_billed')),
  status text not null default 'reserved' check (status in ('reserved','settled','released')),
  released_reason text,
  reserved_at timestamptz not null default now(),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, generation_run_id)
);

create index campaign_ai_spend_reservations_envelope_idx
  on public.campaign_ai_spend_reservations(envelope_id, status, created_at);
create index campaign_ai_spend_reservations_campaign_idx
  on public.campaign_ai_spend_reservations(owner_id, campaign_id, created_at desc);

alter table public.campaign_ai_spend_envelopes enable row level security;
alter table public.campaign_ai_spend_reservations enable row level security;

create policy "admins manage own campaign AI spend envelopes"
  on public.campaign_ai_spend_envelopes for all to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());

create policy "admins view own campaign AI spend reservations"
  on public.campaign_ai_spend_reservations for select to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin());

create trigger set_campaign_ai_spend_envelopes_updated_at
  before update on public.campaign_ai_spend_envelopes
  for each row execute function private.set_updated_at();
create trigger set_campaign_ai_spend_reservations_updated_at
  before update on public.campaign_ai_spend_reservations
  for each row execute function private.set_updated_at();

grant select, insert, update, delete on public.campaign_ai_spend_envelopes to authenticated;
grant select on public.campaign_ai_spend_reservations to authenticated;
grant select, insert, update, delete on public.campaign_ai_spend_envelopes to service_role;
grant select, insert, update, delete on public.campaign_ai_spend_reservations to service_role;

create or replace function private.assert_campaign_spend_actor(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is distinct from p_owner_id or not private.is_studio_admin() then
      raise exception 'Not authorized to manage this campaign AI spend envelope.';
    end if;
  end if;
end;
$$;

create or replace function public.reserve_campaign_ai_spend(
  p_owner_id uuid,
  p_campaign_id uuid,
  p_generation_run_id uuid,
  p_media_kind text,
  p_amount_usd numeric
)
returns public.campaign_ai_spend_reservations
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  envelope_row public.campaign_ai_spend_envelopes%rowtype;
  existing_row public.campaign_ai_spend_reservations%rowtype;
  reservation_row public.campaign_ai_spend_reservations%rowtype;
begin
  perform private.assert_campaign_spend_actor(p_owner_id);
  if p_amount_usd is null or p_amount_usd <= 0 then
    raise exception 'Campaign AI spend reservation must be positive.';
  end if;
  if p_media_kind not in ('image','video') then
    raise exception 'Unsupported campaign AI media kind: %', p_media_kind;
  end if;

  select * into existing_row
  from public.campaign_ai_spend_reservations r
  where r.owner_id = p_owner_id and r.generation_run_id = p_generation_run_id
  limit 1;
  if found then
    return existing_row;
  end if;

  select e.* into envelope_row
  from public.campaign_ai_spend_envelopes e
  join public.campaigns c on c.id = e.campaign_id and c.owner_id = e.owner_id
  where e.owner_id = p_owner_id
    and e.campaign_id = p_campaign_id
    and c.mode = 'autopilot'
  for update of e;

  if not found then
    raise exception 'Autonomous AI spend requires an autopilot campaign with a configured envelope.';
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
  if envelope_row.max_single_generation_usd <= 0 or p_amount_usd > envelope_row.max_single_generation_usd + 0.0001 then
    raise exception 'Generation reservation $% exceeds campaign per-generation ceiling $%.', p_amount_usd, envelope_row.max_single_generation_usd;
  end if;
  if envelope_row.reserved_usd + envelope_row.spent_usd + p_amount_usd > envelope_row.hard_limit_usd + 0.0001 then
    raise exception 'Generation reservation would exceed campaign AI hard limit.';
  end if;

  insert into public.campaign_ai_spend_reservations (
    owner_id, campaign_id, envelope_id, generation_run_id, media_kind, reserved_usd
  ) values (
    p_owner_id, p_campaign_id, envelope_row.id, p_generation_run_id, p_media_kind, round(p_amount_usd, 4)
  ) returning * into reservation_row;

  update public.campaign_ai_spend_envelopes
    set reserved_usd = reserved_usd + reservation_row.reserved_usd
    where id = envelope_row.id;

  return reservation_row;
end;
$$;

create or replace function public.settle_campaign_ai_spend(
  p_owner_id uuid,
  p_reservation_id uuid,
  p_actual_usd numeric,
  p_basis text default 'estimated'
)
returns public.campaign_ai_spend_reservations
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  reservation_row public.campaign_ai_spend_reservations%rowtype;
  actual numeric;
  overrun numeric;
  basis text;
begin
  perform private.assert_campaign_spend_actor(p_owner_id);
  if p_basis not in ('provider_actual','estimated','conservative_reserve','not_billed') then
    raise exception 'Unsupported campaign AI spend settlement basis.';
  end if;

  select * into reservation_row
  from public.campaign_ai_spend_reservations
  where id = p_reservation_id and owner_id = p_owner_id
  for update;
  if not found then raise exception 'Campaign AI spend reservation not found.'; end if;
  if reservation_row.status <> 'reserved' then return reservation_row; end if;

  actual := greatest(0, round(coalesce(p_actual_usd, reservation_row.reserved_usd), 4));
  overrun := greatest(0, actual - reservation_row.reserved_usd);
  basis := case when overrun > 0 then 'provider_actual' else p_basis end;

  update public.campaign_ai_spend_envelopes
    set reserved_usd = greatest(0, reserved_usd - reservation_row.reserved_usd),
        spent_usd = spent_usd + actual,
        overrun_usd = overrun_usd + overrun
    where id = reservation_row.envelope_id;

  update public.campaign_ai_spend_reservations
    set status = 'settled', settled_usd = actual, settlement_basis = basis,
        settled_at = now(), released_reason = null
    where id = reservation_row.id
    returning * into reservation_row;
  return reservation_row;
end;
$$;

create or replace function public.release_campaign_ai_spend(
  p_owner_id uuid,
  p_reservation_id uuid,
  p_reason text default 'not_billed'
)
returns public.campaign_ai_spend_reservations
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  reservation_row public.campaign_ai_spend_reservations%rowtype;
begin
  perform private.assert_campaign_spend_actor(p_owner_id);
  select * into reservation_row
  from public.campaign_ai_spend_reservations
  where id = p_reservation_id and owner_id = p_owner_id
  for update;
  if not found then raise exception 'Campaign AI spend reservation not found.'; end if;
  if reservation_row.status <> 'reserved' then return reservation_row; end if;

  update public.campaign_ai_spend_envelopes
    set reserved_usd = greatest(0, reserved_usd - reservation_row.reserved_usd)
    where id = reservation_row.envelope_id;

  update public.campaign_ai_spend_reservations
    set status = 'released', settled_usd = 0, settlement_basis = 'not_billed',
        released_reason = left(coalesce(p_reason, 'not_billed'), 500), settled_at = now()
    where id = reservation_row.id
    returning * into reservation_row;
  return reservation_row;
end;
$$;

revoke all on function private.assert_campaign_spend_actor(uuid) from public, anon, authenticated;
revoke all on function public.reserve_campaign_ai_spend(uuid,uuid,uuid,text,numeric) from public, anon;
revoke all on function public.settle_campaign_ai_spend(uuid,uuid,numeric,text) from public, anon;
revoke all on function public.release_campaign_ai_spend(uuid,uuid,text) from public, anon;
grant execute on function public.reserve_campaign_ai_spend(uuid,uuid,uuid,text,numeric) to authenticated, service_role;
grant execute on function public.settle_campaign_ai_spend(uuid,uuid,numeric,text) to authenticated, service_role;
grant execute on function public.release_campaign_ai_spend(uuid,uuid,text) to authenticated, service_role;
