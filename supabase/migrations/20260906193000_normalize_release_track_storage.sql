-- Ensemblis canonical music storage.
-- Artist identity lives in public.artists, media lives in media_assets/media_links,
-- and platform identities/URLs live in release_external_links/track_external_ids.
-- There is deliberately no compatibility copy of those values on releases/tracks.

-- The previous transition trigger explicitly listed the denormalized `artist` column in its
-- UPDATE OF clause. Drop that trigger before removing the column, then recreate it against the
-- canonical owner_id + artist_id boundary only.
drop trigger if exists releases_validate_artist_scope on public.releases;

create or replace function private.validate_release_artist_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.artist_id is null then
    raise exception 'artist_id is required for every release';
  end if;

  if not private.profile_can_manage_artist(new.owner_id, new.artist_id) then
    raise exception 'Release owner must be an active member of the artist workspace';
  end if;

  if not exists (
    select 1
    from public.artists a
    where a.id = new.artist_id
  ) then
    raise exception 'Release artist must exist';
  end if;

  return new;
end;
$$;

-- Smart Links used to project destinations from duplicated URL columns on releases. Keep the
-- feature, but move its source to the canonical release_external_links table before dropping
-- those columns.
drop trigger if exists sync_release_smart_link on public.releases;

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
  select id, owner_id, artist_id, title into release_row
  from public.releases
  where id = target_release_id;
  if release_row.id is null then return null; end if;

  select id into site_row
  from public.artist_sites
  where artist_id = release_row.artist_id and state <> 'archived'
  order by created_at asc, id asc
  limit 1;
  if site_row.id is null then return null; end if;

  insert into public.smart_links(owner_id, artist_id, site_id, release_id, slug)
  values (
    release_row.owner_id,
    release_row.artist_id,
    site_row.id,
    release_row.id,
    private.smart_link_slug(release_row.title, release_row.id)
  )
  on conflict (site_id, release_id) do update
    set owner_id = excluded.owner_id,
        artist_id = excluded.artist_id,
        slug = private.smart_link_slug(release_row.title, release_row.id)
  returning id into link_id;

  -- Release-derived destinations are a deterministic projection. Rebuilding them does not erase
  -- attribution history because smart_link_events.destination_id is ON DELETE SET NULL.
  delete from public.smart_link_destinations
  where smart_link_id = link_id and source = 'release';

  insert into public.smart_link_destinations(
    smart_link_id,
    owner_id,
    artist_id,
    provider,
    label,
    destination_url,
    destination_kind,
    sort_order,
    source
  )
  select
    link_id,
    release_row.owner_id,
    release_row.artist_id,
    link.provider::text,
    coalesce(nullif(trim(link.label), ''), initcap(replace(link.provider::text, '_', ' '))),
    link.external_url,
    'streaming',
    case link.provider::text
      when 'spotify' then 10
      when 'apple_music' then 20
      when 'soundcloud' then 30
      when 'youtube' then 40
      when 'bandcamp' then 50
      else 90
    end,
    'release'
  from public.release_external_links link
  where link.release_id = release_row.id
    and link.artist_id = release_row.artist_id
    and link.provider::text in ('spotify', 'apple_music', 'soundcloud', 'youtube', 'bandcamp')
    and link.external_url ~ '^https?://'
  order by
    case link.provider::text
      when 'spotify' then 10
      when 'apple_music' then 20
      when 'soundcloud' then 30
      when 'youtube' then 40
      when 'bandcamp' then 50
      else 90
    end,
    link.created_at asc;

  return link_id;
end;
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
end;
$$;

create trigger sync_release_smart_link
  after insert or update of title, artist_id on public.releases
  for each row execute function private.sync_release_smart_link_trigger();

create or replace function private.sync_release_external_link_smart_link_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_release_smart_link(coalesce(new.release_id, old.release_id));
  return coalesce(new, old);
end;
$$;
revoke all on function private.sync_release_external_link_smart_link_trigger() from public, anon, authenticated;

drop trigger if exists sync_release_external_link_smart_link on public.release_external_links;
create trigger sync_release_external_link_smart_link
  after insert or update of release_id, artist_id, provider, external_url, label
  on public.release_external_links
  for each row execute function private.sync_release_external_link_smart_link_trigger();

drop trigger if exists delete_release_external_link_smart_link on public.release_external_links;
create trigger delete_release_external_link_smart_link
  after delete on public.release_external_links
  for each row execute function private.sync_release_external_link_smart_link_trigger();

alter table public.releases
  drop column if exists artist,
  drop column if exists artwork_url,
  drop column if exists cover_asset,
  drop column if exists cover_alt,
  drop column if exists canvas_video_url,
  drop column if exists public_release_path,
  drop column if exists spotify_url,
  drop column if exists apple_music_url,
  drop column if exists soundcloud_url,
  drop column if exists youtube_url,
  drop column if exists bandcamp_url,
  drop column if exists smart_link_url;

create trigger releases_validate_artist_scope
  before insert or update of owner_id, artist_id on public.releases
  for each row execute function private.validate_release_artist_scope();

-- Platform links are normalized now. The master-audio transition is intentionally completed in
-- a dedicated follow-up migration because existing intelligence invalidation triggers still use
-- tracks.audio_url as their change signal. Runtime no longer receives that field through the
-- canonical Database type while those triggers are being moved to the master_audio media link.
alter table public.tracks
  drop column if exists spotify_url,
  drop column if exists soundcloud_url;
