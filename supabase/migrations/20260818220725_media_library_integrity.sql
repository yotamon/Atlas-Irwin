-- Media-library integrity for reusable role assignments.
-- The application already separates immutable assets from their contextual uses;
-- these constraints make that model safe under retries and concurrent edits.

with duplicates as (
  select id, row_number() over (
    partition by media_asset_id, role, release_id, track_id, content_item_id
    order by created_at, id
  ) as position
  from public.media_links
)
delete from public.media_links
where id in (select id from duplicates where position > 1);

with ranked as (
  select id, row_number() over (
    partition by role, release_id, track_id, content_item_id
    order by updated_at desc, created_at desc, id
  ) as position
  from public.media_links
  where is_primary
)
update public.media_links
set is_primary = false
where id in (select id from ranked where position > 1);

create unique index if not exists media_links_release_asset_role_idx
  on public.media_links(release_id, media_asset_id, role)
  where release_id is not null;

create unique index if not exists media_links_track_asset_role_idx
  on public.media_links(track_id, media_asset_id, role)
  where track_id is not null;

create unique index if not exists media_links_content_asset_role_idx
  on public.media_links(content_item_id, media_asset_id, role)
  where content_item_id is not null;

create unique index if not exists media_links_primary_release_role_idx
  on public.media_links(release_id, role)
  where release_id is not null and is_primary;

create unique index if not exists media_links_primary_track_role_idx
  on public.media_links(track_id, role)
  where track_id is not null and is_primary;

create unique index if not exists media_links_primary_content_role_idx
  on public.media_links(content_item_id, role)
  where content_item_id is not null and is_primary;

create index if not exists media_assets_metadata_search_idx
  on public.media_assets using gin (metadata jsonb_path_ops);

