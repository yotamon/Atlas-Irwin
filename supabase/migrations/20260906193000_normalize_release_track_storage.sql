-- Ensemblis canonical music storage.
-- Artist identity lives in public.artists, media lives in media_assets/media_links,
-- and platform identities/URLs live in release_external_links/track_external_ids.
-- There is deliberately no compatibility copy of those values on releases/tracks.

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

alter table public.tracks
  drop column if exists audio_url,
  drop column if exists spotify_url,
  drop column if exists soundcloud_url;
