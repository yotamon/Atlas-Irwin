-- Carry approved Moment lineage into execution so outcomes can teach Ensemblis which musical
-- evidence actually performs. Marketing remains owner-scoped until #71; every link is additionally
-- constrained through the Moment's canonical Release/Artist lineage.

-- Moments are durable history. Lifecycle states replace physical deletion.
drop policy if exists "studio admins artist delete moments" on public.moments;
revoke delete on table public.moments from authenticated;

alter table public.content_items
  add column if not exists moment_id uuid references public.moments(id) on delete restrict;

create index if not exists content_items_moment_idx
  on public.content_items(moment_id) where moment_id is not null;

create or replace function private.validate_content_item_moment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_release_id uuid;
  v_state public.moment_lifecycle_state;
  v_start_ms integer;
  v_end_ms integer;
begin
  if new.moment_id is null then return new; end if;

  select m.owner_id, m.release_id, m.state, m.start_ms, m.end_ms
    into v_owner_id, v_release_id, v_state, v_start_ms, v_end_ms
  from public.moments m where m.id = new.moment_id;
  if not found then raise exception 'Content Moment must exist'; end if;
  if v_state <> 'approved' then raise exception 'Content may only originate from an approved Moment'; end if;
  if new.owner_id <> v_owner_id then raise exception 'Content owner must match Moment owner'; end if;
  if new.release_id is null or new.release_id <> v_release_id then
    raise exception 'Content release must match Moment release';
  end if;

  -- Capture the actual approved window when the lineage is first attached. Later manual edits to a
  -- content cut remain explicit content-level edits and never rewrite the source Moment.
  if tg_op = 'INSERT' or new.moment_id is distinct from old.moment_id then
    if new.audio_timestamp_start is null then new.audio_timestamp_start := floor(v_start_ms / 1000.0)::integer; end if;
    if new.audio_timestamp_end is null then new.audio_timestamp_end := ceil(v_end_ms / 1000.0)::integer; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_content_item_moment() from public, anon, authenticated;

create trigger content_items_validate_moment
  before insert or update of owner_id, release_id, moment_id on public.content_items
  for each row execute function private.validate_content_item_moment();

create table public.campaign_moments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  moment_id uuid not null references public.moments(id) on delete restrict,
  role text not null default 'supporting' check (role in ('primary','supporting','experiment')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, moment_id)
);

create index campaign_moments_moment_idx on public.campaign_moments(moment_id, is_active);
create unique index campaign_moments_one_primary_idx
  on public.campaign_moments(campaign_id) where role = 'primary' and is_active;

create or replace function private.validate_campaign_moment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_campaign_owner uuid;
  v_campaign_release uuid;
  v_moment_owner uuid;
  v_moment_release uuid;
  v_moment_state public.moment_lifecycle_state;
begin
  select c.owner_id, c.release_id into v_campaign_owner, v_campaign_release
  from public.campaigns c where c.id = new.campaign_id;
  if not found then raise exception 'Campaign must exist'; end if;

  select m.owner_id, m.release_id, m.state into v_moment_owner, v_moment_release, v_moment_state
  from public.moments m where m.id = new.moment_id;
  if not found then raise exception 'Campaign Moment must exist'; end if;

  if v_moment_state <> 'approved' then raise exception 'Campaigns may only use approved Moments'; end if;
  if v_campaign_owner <> v_moment_owner then raise exception 'Campaign and Moment owner must match'; end if;
  if v_campaign_release is null or v_campaign_release <> v_moment_release then
    raise exception 'Campaign and Moment release must match';
  end if;
  if new.owner_id <> v_campaign_owner then raise exception 'Campaign Moment owner must match Campaign owner'; end if;
  return new;
end;
$$;
revoke all on function private.validate_campaign_moment() from public, anon, authenticated;

create trigger campaign_moments_validate_scope
  before insert or update on public.campaign_moments
  for each row execute function private.validate_campaign_moment();
create trigger set_campaign_moments_updated_at
  before update on public.campaign_moments
  for each row execute function private.set_updated_at();

alter table public.campaign_moments enable row level security;
create policy "admins select own campaign_moments" on public.campaign_moments
  for select to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins insert own campaign_moments" on public.campaign_moments
  for insert to authenticated with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins update own campaign_moments" on public.campaign_moments
  for update to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins delete own campaign_moments" on public.campaign_moments
  for delete to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin());
grant select, insert, update, delete on public.campaign_moments to authenticated;
revoke all on public.campaign_moments from anon;

-- Metric snapshots already reference content_items. This security-invoker view makes Moment-level
-- performance a first-class query without duplicating metrics or bypassing underlying RLS.
create view public.moment_performance_rollups
with (security_invoker = true)
as
select
  m.id as moment_id,
  m.owner_id,
  m.artist_id,
  m.release_id,
  count(distinct c.id)::integer as content_items,
  count(ms.id)::integer as metric_snapshots,
  coalesce(sum(ms.reach), 0)::bigint as reach,
  coalesce(sum(ms.views), 0)::bigint as views,
  coalesce(sum(ms.watch_time), 0)::bigint as watch_time,
  coalesce(sum(ms.likes), 0)::bigint as likes,
  coalesce(sum(ms.comments), 0)::bigint as comments,
  coalesce(sum(ms.shares), 0)::bigint as shares,
  coalesce(sum(ms.saves), 0)::bigint as saves,
  coalesce(sum(ms.profile_visits), 0)::bigint as profile_visits,
  coalesce(sum(ms.follows), 0)::bigint as follows,
  coalesce(sum(ms.link_clicks), 0)::bigint as link_clicks,
  coalesce(sum(ms.streams), 0)::bigint as streams,
  coalesce(sum(ms.listeners), 0)::bigint as listeners,
  coalesce(sum(ms.playlist_adds), 0)::bigint as playlist_adds
from public.moments m
left join public.content_items c on c.moment_id = m.id
left join public.metric_snapshots ms on ms.content_item_id = c.id
group by m.id, m.owner_id, m.artist_id, m.release_id;

grant select on public.moment_performance_rollups to authenticated;
revoke all on public.moment_performance_rollups from anon;
