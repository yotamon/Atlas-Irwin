-- Canonical catalog, media, publishing, and homepage placement schema

create type public.publish_state as enum ('draft', 'scheduled', 'live', 'archived');
create type public.release_date_precision as enum ('day', 'month', 'year', 'unknown');
create type public.media_asset_type as enum (
  'cover', 'alternate_artwork', 'canvas_video', 'visualizer', 'audio_preview',
  'master_audio', 'stem', 'social_image', 'press_image', 'lyric_video', 'content_video'
);
create type public.media_visibility as enum ('public', 'private');
create type public.homepage_placement_type as enum ('featured', 'catalog', 'upcoming');
create type public.external_provider as enum (
  'soundcloud', 'spotify', 'youtube', 'isrc', 'upc', 'apple_music', 'bandcamp', 'other'
);
create type public.reconcile_status as enum ('pending', 'linked', 'ignored', 'dismissed');

alter table public.releases
  add column if not exists is_public boolean not null default false,
  add column if not exists publish_state public.publish_state not null default 'draft',
  add column if not exists published_at timestamptz,
  add column if not exists release_date_precision public.release_date_precision not null default 'day',
  add column if not exists is_archived boolean not null default false,
  add column if not exists homepage_eligible boolean not null default true,
  add column if not exists catalog_sort_order integer,
  add column if not exists artist text not null default 'Atlas Irwin',
  add column if not exists upc text,
  add column if not exists genre text,
  add column if not exists subgenre text,
  add column if not exists label text,
  add column if not exists cta_label text,
  add column if not exists cta_href text,
  add column if not exists cover_alt text,
  add column if not exists is_featured boolean not null default false,
  add column if not exists active_release boolean not null default false;

create index if not exists releases_publish_idx on public.releases(owner_id, publish_state, is_public);
create index if not exists releases_homepage_idx on public.releases(owner_id, homepage_eligible) where is_public and publish_state = 'live';

alter table public.tracks
  add column if not exists track_number integer,
  add column if not exists display_order integer not null default 0;

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  bucket_name text not null,
  storage_path text not null,
  public_url text,
  asset_type public.media_asset_type not null,
  mime_type text,
  file_size bigint check(file_size is null or file_size >= 0),
  content_hash text,
  width integer check(width is null or width > 0),
  height integer check(height is null or height > 0),
  duration_ms integer check(duration_ms is null or duration_ms >= 0),
  visibility public.media_visibility not null default 'private',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, bucket_name, storage_path)
);

create table public.media_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  release_id uuid references public.releases(id) on delete cascade,
  track_id uuid references public.tracks(id) on delete cascade,
  content_item_id uuid references public.content_items(id) on delete cascade,
  role public.media_asset_type not null,
  display_order integer not null default 0,
  is_primary boolean not null default false,
  caption text,
  alt_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_links_parent_check check (
    num_nonnulls(release_id, track_id, content_item_id) >= 1
  )
);

create table public.track_external_ids (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  provider public.external_provider not null,
  external_id text not null,
  external_url text,
  raw_metadata jsonb not null default '{}',
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, external_id),
  unique(track_id, provider)
);

create table public.release_external_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  release_id uuid not null references public.releases(id) on delete cascade,
  provider public.external_provider not null,
  external_id text,
  external_url text not null,
  label text,
  raw_metadata jsonb not null default '{}',
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(release_id, provider, external_url)
);

create table public.homepage_placements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  release_id uuid not null references public.releases(id) on delete cascade,
  enabled boolean not null default true,
  display_order integer not null default 0,
  default_track_id uuid references public.tracks(id) on delete set null,
  placement_type public.homepage_placement_type not null default 'catalog',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, release_id)
);

alter table public.soundcloud_tracks
  add column if not exists linked_track_id uuid references public.tracks(id) on delete set null,
  add column if not exists linked_release_id uuid references public.releases(id) on delete set null,
  add column if not exists reconcile_status public.reconcile_status not null default 'pending',
  add column if not exists reconciled_at timestamptz;

alter table public.spotify_tracks
  add column if not exists linked_track_id uuid references public.tracks(id) on delete set null,
  add column if not exists linked_release_id uuid references public.releases(id) on delete set null,
  add column if not exists reconcile_status public.reconcile_status not null default 'pending',
  add column if not exists reconciled_at timestamptz;

alter table public.spotify_albums
  add column if not exists linked_release_id uuid references public.releases(id) on delete set null,
  add column if not exists reconcile_status public.reconcile_status not null default 'pending',
  add column if not exists reconciled_at timestamptz;

create index media_assets_owner_type_idx on public.media_assets(owner_id, asset_type);
create index media_assets_hash_idx on public.media_assets(owner_id, content_hash) where content_hash is not null;
create index media_links_release_idx on public.media_links(release_id, role, display_order);
create index media_links_track_idx on public.media_links(track_id, role);
create index track_external_ids_track_idx on public.track_external_ids(track_id);
create index release_external_links_release_idx on public.release_external_links(release_id);
create index homepage_placements_order_idx on public.homepage_placements(owner_id, enabled, display_order);
create index soundcloud_tracks_reconcile_idx on public.soundcloud_tracks(owner_id, reconcile_status);
create index spotify_tracks_reconcile_idx on public.spotify_tracks(owner_id, reconcile_status);

create unique index media_links_primary_cover_idx
  on public.media_links(release_id, role)
  where is_primary and release_id is not null and role = 'cover';

create function private.validate_homepage_default_track() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.default_track_id is not null then
    if not exists (
      select 1 from public.tracks t
      where t.id = new.default_track_id and t.release_id = new.release_id
    ) then
      raise exception 'default_track_id must belong to the placement release';
    end if;
  end if;
  return new;
end $$;

create trigger homepage_placements_default_track_check
  before insert or update of default_track_id, release_id on public.homepage_placements
  for each row execute function private.validate_homepage_default_track();

create function private.enforce_single_active_release() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.active_release then
    update public.releases
      set active_release = false, updated_at = now()
      where owner_id = new.owner_id and id <> new.id and active_release;
  end if;
  return new;
end $$;

create trigger releases_single_active
  before insert or update of active_release on public.releases
  for each row when (new.active_release)
  execute function private.enforce_single_active_release();

-- Storage buckets
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'public-media', 'public-media', true, 104857600,
  array['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm','audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/flac']
) on conflict(id) do nothing;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'studio-private', 'studio-private', false, 524288000,
  array['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm','audio/mpeg','audio/wav','audio/x-wav','audio/flac','application/zip']
) on conflict(id) do nothing;

-- RLS for new tables
alter table public.media_assets enable row level security;
alter table public.media_links enable row level security;
alter table public.track_external_ids enable row level security;
alter table public.release_external_links enable row level security;
alter table public.homepage_placements enable row level security;

create policy "admins select own media_assets" on public.media_assets
  for select to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins insert own media_assets" on public.media_assets
  for insert to authenticated with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins update own media_assets" on public.media_assets
  for update to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins delete own media_assets" on public.media_assets
  for delete to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin());

create policy "public read public media_assets" on public.media_assets
  for select to anon using (visibility = 'public' and public_url is not null);

create policy "admins select own media_links" on public.media_links
  for select to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins insert own media_links" on public.media_links
  for insert to authenticated with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins update own media_links" on public.media_links
  for update to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins delete own media_links" on public.media_links
  for delete to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin());

create policy "admins select own track_external_ids" on public.track_external_ids
  for select to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins insert own track_external_ids" on public.track_external_ids
  for insert to authenticated with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins update own track_external_ids" on public.track_external_ids
  for update to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins delete own track_external_ids" on public.track_external_ids
  for delete to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin());

create policy "admins select own release_external_links" on public.release_external_links
  for select to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins insert own release_external_links" on public.release_external_links
  for insert to authenticated with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins update own release_external_links" on public.release_external_links
  for update to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins delete own release_external_links" on public.release_external_links
  for delete to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin());

create policy "admins select own homepage_placements" on public.homepage_placements
  for select to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins insert own homepage_placements" on public.homepage_placements
  for insert to authenticated with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins update own homepage_placements" on public.homepage_placements
  for update to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins delete own homepage_placements" on public.homepage_placements
  for delete to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin());

-- Public read for published catalog (anon + authenticated)
create policy "public read live releases" on public.releases
  for select to anon using (
    is_public and publish_state = 'live' and not is_archived
  );

create policy "public read live release tracks" on public.tracks
  for select to anon using (
    exists (
      select 1 from public.releases r
      where r.id = tracks.release_id
        and r.is_public and r.publish_state = 'live' and not r.is_archived
    )
  );

create policy "public read enabled homepage placements" on public.homepage_placements
  for select to anon using (
    enabled and exists (
      select 1 from public.releases r
      where r.id = homepage_placements.release_id
        and r.is_public and r.publish_state = 'live' and not r.is_archived
    )
  );

create policy "public read release external links" on public.release_external_links
  for select to anon using (
    exists (
      select 1 from public.releases r
      where r.id = release_external_links.release_id
        and r.is_public and r.publish_state = 'live' and not r.is_archived
    )
  );

create policy "public read track external ids" on public.track_external_ids
  for select to anon using (
    exists (
      select 1 from public.tracks t
      join public.releases r on r.id = t.release_id
      where t.id = track_external_ids.track_id
        and r.is_public and r.publish_state = 'live' and not r.is_archived
    )
  );

create policy "public read public media links" on public.media_links
  for select to anon using (
    exists (
      select 1 from public.media_assets ma
      where ma.id = media_links.media_asset_id and ma.visibility = 'public'
    ) and (
      (release_id is not null and exists (
        select 1 from public.releases r
        where r.id = media_links.release_id
          and r.is_public and r.publish_state = 'live' and not r.is_archived
      )) or (track_id is not null and exists (
        select 1 from public.tracks t
        join public.releases r on r.id = t.release_id
        where t.id = media_links.track_id
          and r.is_public and r.publish_state = 'live' and not r.is_archived
      ))
    )
  );

-- Storage policies
create policy "public read public-media" on storage.objects
  for select to anon using (bucket_id = 'public-media');

create policy "admins read public-media" on storage.objects
  for select to authenticated using (
    bucket_id = 'public-media' and private.is_studio_admin()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "admins upload public-media" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'public-media' and private.is_studio_admin()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "admins update public-media" on storage.objects
  for update to authenticated using (
    bucket_id = 'public-media' and private.is_studio_admin()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  ) with check (
    bucket_id = 'public-media' and private.is_studio_admin()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "admins delete public-media" on storage.objects
  for delete to authenticated using (
    bucket_id = 'public-media' and private.is_studio_admin()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "admins read studio-private" on storage.objects
  for select to authenticated using (
    bucket_id = 'studio-private' and private.is_studio_admin()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "admins upload studio-private" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'studio-private' and private.is_studio_admin()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "admins update studio-private" on storage.objects
  for update to authenticated using (
    bucket_id = 'studio-private' and private.is_studio_admin()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  ) with check (
    bucket_id = 'studio-private' and private.is_studio_admin()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "admins delete studio-private" on storage.objects
  for delete to authenticated using (
    bucket_id = 'studio-private' and private.is_studio_admin()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Updated_at triggers
do $$ declare t text; begin
  foreach t in array array['media_assets','media_links','track_external_ids','release_external_links','homepage_placements'] loop
    execute format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

grant select on public.media_assets, public.media_links, public.track_external_ids,
  public.release_external_links, public.homepage_placements to anon;

-- Backfill legacy Live releases into the publishing model
update public.releases
set
  is_public = true,
  publish_state = 'live',
  published_at = coalesce(published_at, (release_date::timestamptz at time zone 'UTC'), now()),
  updated_at = now()
where status = 'Live' and not is_archived and publish_state = 'draft' and not is_public;

with ranked as (
  select
    r.id,
    r.owner_id,
    row_number() over (partition by r.owner_id order by r.release_date desc nulls last, r.title) - 1 as display_order,
    (
      select t.id from public.tracks t
      where t.release_id = r.id and t.is_primary
      order by t.title
      limit 1
    ) as default_track_id
  from public.releases r
  where r.status = 'Live' and r.is_public and r.publish_state = 'live'
)
insert into public.homepage_placements (owner_id, release_id, enabled, display_order, default_track_id, placement_type)
select
  owner_id,
  id,
  true,
  display_order,
  default_track_id,
  case
    when display_order = 0 then 'featured'::public.homepage_placement_type
    else 'catalog'::public.homepage_placement_type
  end
from ranked
on conflict (owner_id, release_id) do nothing;
