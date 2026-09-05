-- Ensemblis Smart Links + first-party attribution.
-- One dynamic release destination per artist Site/release. Public events are intentionally
-- sessionless: no IP address, browser fingerprint, user-agent hash or synthetic identity.

create table public.smart_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  site_id uuid not null references public.artist_sites(id) on delete cascade,
  release_id uuid not null references public.releases(id) on delete cascade,
  slug text not null check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  goal text not null default 'streams' check (goal in ('streams','saves','follows','discovery','community')),
  fallback_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, release_id),
  unique (site_id, slug)
);

create table public.smart_link_destinations (
  id uuid primary key default gen_random_uuid(),
  smart_link_id uuid not null references public.smart_links(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  provider text not null check (length(trim(provider)) > 0),
  label text not null check (length(trim(label)) > 0),
  destination_url text not null check (destination_url ~ '^https?://'),
  destination_kind text not null default 'streaming' check (destination_kind in ('streaming','pre_save','fallback')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  source text not null default 'manual' check (source in ('release','manual','provider')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (smart_link_id, provider, destination_kind)
);

create table public.smart_link_sources (
  id uuid primary key default gen_random_uuid(),
  smart_link_id uuid not null references public.smart_links(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  content_item_id uuid references public.content_items(id) on delete set null,
  moment_id uuid references public.moments(id) on delete set null,
  code text not null unique check (code ~ '^[A-Za-z0-9_-]{8,64}$'),
  label text,
  created_at timestamptz not null default now()
);

create table public.smart_link_events (
  id uuid primary key default gen_random_uuid(),
  smart_link_id uuid not null references public.smart_links(id) on delete cascade,
  destination_id uuid references public.smart_link_destinations(id) on delete set null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  release_id uuid not null references public.releases(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  content_item_id uuid references public.content_items(id) on delete set null,
  moment_id uuid references public.moments(id) on delete set null,
  source_code text,
  event_type text not null check (event_type in ('landing_view','outbound_click','pre_save_start','pre_save_completion')),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  referrer_host text,
  verified boolean not null default false,
  verification_reference text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint smart_link_verified_completion check (
    event_type <> 'pre_save_completion' or (verified and verification_reference is not null)
  )
);

create index smart_links_artist_release_idx on public.smart_links(artist_id, release_id);
create index smart_link_destinations_link_idx on public.smart_link_destinations(smart_link_id, destination_kind, sort_order);
create index smart_link_sources_lineage_idx on public.smart_link_sources(artist_id, campaign_id, content_item_id, moment_id);
create index smart_link_events_release_time_idx on public.smart_link_events(artist_id, release_id, occurred_at desc);
create index smart_link_events_content_moment_idx on public.smart_link_events(content_item_id, moment_id, occurred_at desc);

create trigger set_smart_links_updated_at
  before update on public.smart_links
  for each row execute function private.set_updated_at();
create trigger set_smart_link_destinations_updated_at
  before update on public.smart_link_destinations
  for each row execute function private.set_updated_at();

create or replace function private.smart_link_slug(target_title text, target_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from left(
    coalesce(nullif(regexp_replace(lower(coalesce(target_title, 'release')), '[^a-z0-9]+', '-', 'g'), ''), 'release')
    || '-' || left(replace(target_id::text, '-', ''), 8),
    96
  ))
$$;

create or replace function private.validate_smart_link_lineage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.releases release
    join public.artist_sites site on site.id = new.site_id
    where release.id = new.release_id
      and release.owner_id = new.owner_id
      and release.artist_id = new.artist_id
      and site.artist_id = new.artist_id
  ) then
    raise exception 'Smart Link site, release, owner and artist lineage must match';
  end if;
  return new;
end
$$;

create trigger validate_smart_link_lineage
  before insert or update of owner_id, artist_id, site_id, release_id on public.smart_links
  for each row execute function private.validate_smart_link_lineage();

create or replace function private.validate_smart_link_child_lineage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  link_artist uuid;
  link_owner uuid;
  link_release uuid;
begin
  select artist_id, owner_id, release_id into link_artist, link_owner, link_release
  from public.smart_links where id = new.smart_link_id;

  if link_artist is null or new.artist_id <> link_artist or new.owner_id <> link_owner then
    raise exception 'Smart Link child lineage must match its parent';
  end if;

  if tg_table_name = 'smart_link_sources' then
    if new.campaign_id is not null and not exists (
      select 1 from public.campaigns c where c.id = new.campaign_id and c.artist_id = link_artist and c.owner_id = link_owner
    ) then raise exception 'Smart Link campaign lineage mismatch'; end if;
    if new.content_item_id is not null and not exists (
      select 1 from public.content_items item where item.id = new.content_item_id and item.artist_id = link_artist and item.owner_id = link_owner and item.release_id = link_release
    ) then raise exception 'Smart Link content lineage mismatch'; end if;
    if new.moment_id is not null and not exists (
      select 1 from public.moments moment where moment.id = new.moment_id and moment.artist_id = link_artist and moment.release_id = link_release
    ) then raise exception 'Smart Link Moment lineage mismatch'; end if;
  end if;
  return new;
end
$$;

create trigger validate_smart_link_destination_lineage
  before insert or update of smart_link_id, owner_id, artist_id on public.smart_link_destinations
  for each row execute function private.validate_smart_link_child_lineage();
create trigger validate_smart_link_source_lineage
  before insert or update on public.smart_link_sources
  for each row execute function private.validate_smart_link_child_lineage();

create or replace function private.ensure_release_smart_link(target_release_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  release_row record;
  site_row record;
  link_id uuid;
begin
  select id, owner_id, artist_id, title, spotify_url, soundcloud_url, youtube_url, bandcamp_url
    into release_row
  from public.releases
  where id = target_release_id;
  if release_row.id is null then return null; end if;

  select id into site_row
  from public.artist_sites
  where artist_id = release_row.artist_id and state <> 'archived'
  limit 1;
  if site_row.id is null then return null; end if;

  insert into public.smart_links(owner_id, artist_id, site_id, release_id, slug)
  values (release_row.owner_id, release_row.artist_id, site_row.id, release_row.id, private.smart_link_slug(release_row.title, release_row.id))
  on conflict (site_id, release_id) do update
    set owner_id = excluded.owner_id,
        artist_id = excluded.artist_id,
        slug = private.smart_link_slug(release_row.title, release_row.id)
  returning id into link_id;

  if release_row.spotify_url is not null and release_row.spotify_url ~ '^https?://' then
    insert into public.smart_link_destinations(smart_link_id, owner_id, artist_id, provider, label, destination_url, destination_kind, sort_order, source)
    values (link_id, release_row.owner_id, release_row.artist_id, 'spotify', 'Spotify', release_row.spotify_url, 'streaming', 10, 'release')
    on conflict (smart_link_id, provider, destination_kind) do update set destination_url = excluded.destination_url, label = excluded.label, is_active = true;
  end if;
  if release_row.soundcloud_url is not null and release_row.soundcloud_url ~ '^https?://' then
    insert into public.smart_link_destinations(smart_link_id, owner_id, artist_id, provider, label, destination_url, destination_kind, sort_order, source)
    values (link_id, release_row.owner_id, release_row.artist_id, 'soundcloud', 'SoundCloud', release_row.soundcloud_url, 'streaming', 20, 'release')
    on conflict (smart_link_id, provider, destination_kind) do update set destination_url = excluded.destination_url, label = excluded.label, is_active = true;
  end if;
  if release_row.youtube_url is not null and release_row.youtube_url ~ '^https?://' then
    insert into public.smart_link_destinations(smart_link_id, owner_id, artist_id, provider, label, destination_url, destination_kind, sort_order, source)
    values (link_id, release_row.owner_id, release_row.artist_id, 'youtube', 'YouTube', release_row.youtube_url, 'streaming', 30, 'release')
    on conflict (smart_link_id, provider, destination_kind) do update set destination_url = excluded.destination_url, label = excluded.label, is_active = true;
  end if;
  if release_row.bandcamp_url is not null and release_row.bandcamp_url ~ '^https?://' then
    insert into public.smart_link_destinations(smart_link_id, owner_id, artist_id, provider, label, destination_url, destination_kind, sort_order, source)
    values (link_id, release_row.owner_id, release_row.artist_id, 'bandcamp', 'Bandcamp', release_row.bandcamp_url, 'streaming', 40, 'release')
    on conflict (smart_link_id, provider, destination_kind) do update set destination_url = excluded.destination_url, label = excluded.label, is_active = true;
  end if;

  return link_id;
end
$$;

revoke all on function private.ensure_release_smart_link(uuid) from public, anon;

create or replace function private.sync_release_smart_link_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_release_smart_link(new.id);
  return new;
end
$$;

create trigger sync_release_smart_link
  after insert or update of title, artist_id, spotify_url, soundcloud_url, youtube_url, bandcamp_url on public.releases
  for each row execute function private.sync_release_smart_link_trigger();

create or replace function private.sync_artist_site_smart_links_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  release_row record;
begin
  if new.state <> 'archived' then
    for release_row in select id from public.releases where artist_id = new.artist_id loop
      perform private.ensure_release_smart_link(release_row.id);
    end loop;
  end if;
  return new;
end
$$;

create trigger sync_artist_site_smart_links
  after insert or update of state on public.artist_sites
  for each row execute function private.sync_artist_site_smart_links_trigger();

-- Backfill all current artist/site releases.
do $$
declare release_row record;
begin
  for release_row in
    select release.id from public.releases release
    join public.artist_sites site on site.artist_id = release.artist_id and site.state <> 'archived'
  loop
    perform private.ensure_release_smart_link(release_row.id);
  end loop;
end $$;

alter table public.smart_links enable row level security;
alter table public.smart_link_destinations enable row level security;
alter table public.smart_link_sources enable row level security;
alter table public.smart_link_events enable row level security;

create policy "studio admins manage accessible smart links"
  on public.smart_links for all to authenticated
  using (private.is_studio_admin() and private.can_access_artist(artist_id))
  with check (private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "studio admins manage accessible smart link destinations"
  on public.smart_link_destinations for all to authenticated
  using (private.is_studio_admin() and private.can_access_artist(artist_id))
  with check (private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "studio admins manage accessible smart link sources"
  on public.smart_link_sources for all to authenticated
  using (private.is_studio_admin() and private.can_access_artist(artist_id))
  with check (private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "studio admins read accessible smart link events"
  on public.smart_link_events for select to authenticated
  using (private.is_studio_admin() and private.can_access_artist(artist_id));

create or replace function public.record_smart_link_event(
  p_site_id uuid,
  p_slug text,
  p_event_type text,
  p_destination_id uuid default null,
  p_source_code text default null,
  p_referrer_host text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_content text default null
)
returns table (smart_link_id uuid, release_id uuid, destination_url text, destination_kind text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_row record;
  destination_row record;
  source_row record;
  normalized_event text;
begin
  if p_event_type not in ('landing_view','outbound_click','pre_save_start') then
    raise exception 'Unsupported public Smart Link event';
  end if;

  select link.id, link.owner_id, link.artist_id, link.release_id
    into link_row
  from public.smart_links link
  join public.artist_sites site on site.id = link.site_id
  where link.site_id = p_site_id and link.slug = p_slug and link.is_active and site.state = 'published';
  if link_row.id is null then return; end if;

  if p_destination_id is not null then
    select destination.id, destination.destination_url, destination.destination_kind
      into destination_row
    from public.smart_link_destinations destination
    where destination.id = p_destination_id
      and destination.smart_link_id = link_row.id
      and destination.is_active;
    if destination_row.id is null then return; end if;
  end if;

  if p_source_code is not null then
    select source.campaign_id, source.content_item_id, source.moment_id, source.code
      into source_row
    from public.smart_link_sources source
    where source.smart_link_id = link_row.id and source.code = p_source_code;
  end if;

  normalized_event := case
    when p_event_type = 'outbound_click' and destination_row.destination_kind = 'pre_save' then 'pre_save_start'
    else p_event_type
  end;

  insert into public.smart_link_events(
    smart_link_id, destination_id, owner_id, artist_id, release_id,
    campaign_id, content_item_id, moment_id, source_code, event_type,
    utm_source, utm_medium, utm_campaign, utm_content, referrer_host, verified
  ) values (
    link_row.id, destination_row.id, link_row.owner_id, link_row.artist_id, link_row.release_id,
    source_row.campaign_id, source_row.content_item_id, source_row.moment_id, source_row.code, normalized_event,
    left(nullif(p_utm_source, ''), 200), left(nullif(p_utm_medium, ''), 200),
    left(nullif(p_utm_campaign, ''), 200), left(nullif(p_utm_content, ''), 200),
    left(nullif(p_referrer_host, ''), 255), false
  );

  return query select link_row.id, link_row.release_id, destination_row.destination_url, destination_row.destination_kind;
end
$$;

revoke all on function public.record_smart_link_event(uuid,text,text,uuid,text,text,text,text,text,text) from public;
grant execute on function public.record_smart_link_event(uuid,text,text,uuid,text,text,text,text,text,text) to anon, authenticated, service_role;

create or replace function public.record_verified_pre_save_completion(
  p_destination_id uuid,
  p_source_code text,
  p_verification_reference text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  destination_row record;
  source_row record;
  event_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Verified pre-save completion requires a trusted provider callback';
  end if;
  if length(trim(coalesce(p_verification_reference, ''))) < 4 then
    raise exception 'Verification reference is required';
  end if;

  select destination.id, destination.smart_link_id, destination.owner_id, destination.artist_id, link.release_id
    into destination_row
  from public.smart_link_destinations destination
  join public.smart_links link on link.id = destination.smart_link_id
  where destination.id = p_destination_id and destination.destination_kind = 'pre_save' and destination.is_active;
  if destination_row.id is null then raise exception 'Pre-save destination not found'; end if;

  select campaign_id, content_item_id, moment_id, code into source_row
  from public.smart_link_sources
  where smart_link_id = destination_row.smart_link_id and code = p_source_code;

  insert into public.smart_link_events(
    smart_link_id, destination_id, owner_id, artist_id, release_id,
    campaign_id, content_item_id, moment_id, source_code, event_type,
    verified, verification_reference, metadata
  ) values (
    destination_row.smart_link_id, destination_row.id, destination_row.owner_id, destination_row.artist_id, destination_row.release_id,
    source_row.campaign_id, source_row.content_item_id, source_row.moment_id, source_row.code, 'pre_save_completion',
    true, p_verification_reference, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into event_id;
  return event_id;
end
$$;

revoke all on function public.record_verified_pre_save_completion(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_verified_pre_save_completion(uuid,text,text,jsonb) to service_role;

create or replace view public.smart_link_readback
with (security_invoker = true)
as
select
  link.id as smart_link_id,
  link.owner_id,
  link.artist_id,
  link.release_id,
  release.release_date,
  count(event.id) filter (where event.event_type = 'landing_view') as landing_views,
  count(event.id) filter (where event.event_type = 'outbound_click') as outbound_clicks,
  count(event.id) filter (where event.event_type = 'pre_save_start') as pre_save_starts,
  count(event.id) filter (where event.event_type = 'pre_save_completion' and event.verified) as verified_pre_save_completions,
  count(event.id) filter (
    where event.occurred_at >= release.release_date::timestamptz
      and event.occurred_at < release.release_date::timestamptz + interval '7 days'
      and event.event_type in ('outbound_click','pre_save_start','pre_save_completion')
  ) as launch_actions_day_7,
  count(event.id) filter (
    where event.occurred_at >= release.release_date::timestamptz
      and event.occurred_at < release.release_date::timestamptz + interval '30 days'
      and event.event_type in ('outbound_click','pre_save_start','pre_save_completion')
  ) as launch_actions_day_30,
  max(event.occurred_at) as last_event_at
from public.smart_links link
join public.releases release on release.id = link.release_id
left join public.smart_link_events event on event.smart_link_id = link.id
group by link.id, link.owner_id, link.artist_id, link.release_id, release.release_date;

grant select on public.smart_link_readback to authenticated, service_role;

-- Retire the old IP + user-agent fingerprint dependency. The legacy redirect keeps
-- raw click counting but no longer requires or stores a synthetic visitor identity.
create or replace function public.record_attribution_click(
  p_code text,
  p_visitor_hash text default null,
  p_referrer text default null,
  p_user_agent text default null
)
returns table(destination_url text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_row record;
begin
  select * into link_row
  from public.attribution_links link
  where link.code = p_code and link.is_active;
  if link_row.id is null then return; end if;

  insert into public.attribution_events(
    owner_id, artist_id, attribution_link_id, event_type, visitor_hash, referrer, user_agent,
    metadata, occurred_at
  ) values (
    link_row.owner_id, link_row.artist_id, link_row.id, 'click', null,
    left(nullif(p_referrer, ''), 1000), null,
    jsonb_build_object('privacy_mode', 'sessionless'), now()
  );

  update public.attribution_links
    set click_count = click_count + 1,
        last_clicked_at = now(),
        updated_at = now()
  where id = link_row.id;

  if link_row.content_variant_id is not null then
    insert into public.metric_snapshots(owner_id, artist_id, content_variant_id, source, captured_at, link_clicks)
    values (link_row.owner_id, link_row.artist_id, link_row.content_variant_id, 'attribution', now(), 1);
  end if;

  return query select link_row.destination_url;
end
$$;
