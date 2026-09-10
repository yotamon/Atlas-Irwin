-- Ensemblis #70: media assets may remain reusable at account/workspace scope, but a
-- media usage attached to canonical music must inherit the Artist of its Release/Track.
-- This also repairs the legacy single-active-release trigger so it is artist-local.

alter table public.media_links
  add column if not exists artist_id uuid references public.artists(id) on delete restrict;

-- Existing links are allowed to have more than one parent by the legacy schema. If both
-- music parents are present they must agree before we can establish deterministic lineage.
do $$
begin
  if exists (
    select 1
    from public.media_links ml
    join public.releases r on r.id = ml.release_id
    join public.tracks t on t.id = ml.track_id
    where r.artist_id <> t.artist_id
  ) then
    raise exception 'Cannot migrate media_links with conflicting Release and Track artists';
  end if;
end $$;

update public.media_links ml
set artist_id = r.artist_id
from public.releases r
where ml.release_id = r.id
  and ml.artist_id is distinct from r.artist_id;

update public.media_links ml
set artist_id = t.artist_id
from public.tracks t
where ml.track_id = t.id
  and ml.artist_id is distinct from t.artist_id;

create or replace function private.validate_media_link_artist_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_release_artist_id uuid;
  v_track_artist_id uuid;
  v_artist_id uuid;
begin
  if new.release_id is not null then
    select r.artist_id into v_release_artist_id
    from public.releases r
    where r.id = new.release_id;
    if v_release_artist_id is null then
      raise exception 'media_links Release must exist and be artist-scoped';
    end if;
  end if;

  if new.track_id is not null then
    select t.artist_id into v_track_artist_id
    from public.tracks t
    where t.id = new.track_id;
    if v_track_artist_id is null then
      raise exception 'media_links Track must exist and be artist-scoped';
    end if;
  end if;

  if v_release_artist_id is not null
     and v_track_artist_id is not null
     and v_release_artist_id <> v_track_artist_id then
    raise exception 'media_links Release and Track must belong to the same artist';
  end if;

  v_artist_id := coalesce(v_release_artist_id, v_track_artist_id);
  if v_artist_id is not null then
    if new.artist_id is not null and new.artist_id <> v_artist_id then
      raise exception 'media_links artist must match music target artist';
    end if;
    new.artist_id := v_artist_id;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_media_link_artist_scope() from public, anon, authenticated;

drop trigger if exists media_links_validate_artist_scope on public.media_links;
create trigger media_links_validate_artist_scope
  before insert or update of release_id, track_id, artist_id on public.media_links
  for each row execute function private.validate_media_link_artist_scope();

alter table public.media_links
  drop constraint if exists media_links_music_artist_check;
alter table public.media_links
  add constraint media_links_music_artist_check check (
    (release_id is null and track_id is null) or artist_id is not null
  );

create index if not exists media_links_artist_release_idx
  on public.media_links(artist_id, release_id, role, display_order)
  where release_id is not null;
create index if not exists media_links_artist_track_idx
  on public.media_links(artist_id, track_id, role)
  where track_id is not null;

create policy "studio admins artist select media_links" on public.media_links
  for select to authenticated
  using (artist_id is not null and private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "studio admins artist insert media_links" on public.media_links
  for insert to authenticated
  with check (artist_id is not null and private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "studio admins artist update media_links" on public.media_links
  for update to authenticated
  using (artist_id is not null and private.is_studio_admin() and private.can_access_artist(artist_id))
  with check (artist_id is not null and private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "studio admins artist delete media_links" on public.media_links
  for delete to authenticated
  using (artist_id is not null and private.is_studio_admin() and private.can_access_artist(artist_id));

-- The original catalog trigger enforced one active release per owner. In Ensemblis the
-- invariant is one active release per Artist, otherwise activating Artist B mutates Artist A.
create or replace function private.enforce_single_active_release()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.active_release then
    update public.releases
      set active_release = false, updated_at = now()
      where artist_id = new.artist_id
        and id <> new.id
        and active_release;
  end if;
  return new;
end;
$$;
