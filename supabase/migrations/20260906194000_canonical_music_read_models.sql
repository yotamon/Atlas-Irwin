-- Canonical read projections for Ensemblis music entities.
-- These views contain no persisted compatibility state. They compose artist identity, media and
-- external destinations from their normalized sources while preserving underlying RLS.

create or replace view public.release_read_model
with (security_invoker = true)
as
select
  r.id,
  r.owner_id,
  r.artist_id,
  r.title,
  r.slug,
  r.release_type,
  r.status,
  r.release_date,
  r.story,
  r.core_emotion,
  r.audience,
  r.primary_hook,
  r.visual_direction,
  r.color_palette,
  r.notes,
  r.public_slug,
  r.story_answers,
  r.release_identity,
  r.readiness,
  r.is_public,
  r.publish_state,
  r.published_at,
  r.release_date_precision,
  r.is_archived,
  r.homepage_eligible,
  r.catalog_sort_order,
  r.upc,
  r.genre,
  r.subgenre,
  r.label,
  r.cta_label,
  r.cta_href,
  r.is_featured,
  r.active_release,
  r.created_at,
  r.updated_at,
  a.name as artist_name,
  cover.media_asset_id as cover_asset_id,
  cover.public_url as cover_url,
  cover.alt_text as cover_alt,
  links.spotify_url,
  links.apple_music_url,
  links.soundcloud_url,
  links.youtube_url,
  links.bandcamp_url,
  smart.slug as smart_link_slug,
  smart.site_id as smart_link_site_id
from public.releases r
join public.artists a on a.id = r.artist_id
left join lateral (
  select
    ml.media_asset_id,
    ma.public_url,
    ml.alt_text
  from public.media_links ml
  join public.media_assets ma on ma.id = ml.media_asset_id
  where ml.release_id = r.id
    and ml.artist_id = r.artist_id
    and ml.role = 'cover'
  order by ml.is_primary desc, ml.display_order asc, ml.created_at asc
  limit 1
) cover on true
left join lateral (
  select
    max(rel.external_url) filter (where rel.provider = 'spotify') as spotify_url,
    max(rel.external_url) filter (where rel.provider = 'apple_music') as apple_music_url,
    max(rel.external_url) filter (where rel.provider = 'soundcloud') as soundcloud_url,
    max(rel.external_url) filter (where rel.provider = 'youtube') as youtube_url,
    max(rel.external_url) filter (where rel.provider = 'bandcamp') as bandcamp_url
  from public.release_external_links rel
  where rel.release_id = r.id and rel.artist_id = r.artist_id
) links on true
left join lateral (
  select sl.slug, sl.site_id
  from public.smart_links sl
  where sl.release_id = r.id
    and sl.artist_id = r.artist_id
    and sl.is_active
  order by sl.created_at asc, sl.id asc
  limit 1
) smart on true;

create or replace view public.track_read_model
with (security_invoker = true)
as
select
  t.id,
  t.release_id,
  t.owner_id,
  t.artist_id,
  t.title,
  t.version,
  t.duration,
  t.is_primary,
  t.notes,
  t.track_number,
  t.display_order,
  t.created_at,
  t.updated_at,
  master.media_asset_id as master_audio_asset_id,
  master.public_url as master_audio_url,
  master.bucket_name as master_audio_bucket_name,
  master.storage_path as master_audio_storage_path,
  ids.spotify_url,
  ids.soundcloud_url,
  ids.youtube_url,
  ids.apple_music_url
from public.tracks t
left join lateral (
  select
    ml.media_asset_id,
    ma.public_url,
    ma.bucket_name,
    ma.storage_path
  from public.media_links ml
  join public.media_assets ma on ma.id = ml.media_asset_id
  where ml.track_id = t.id
    and ml.artist_id = t.artist_id
    and ml.role = 'master_audio'
  order by ml.is_primary desc, ml.display_order asc, ml.created_at asc
  limit 1
) master on true
left join lateral (
  select
    max(te.external_url) filter (where te.provider = 'spotify') as spotify_url,
    max(te.external_url) filter (where te.provider = 'soundcloud') as soundcloud_url,
    max(te.external_url) filter (where te.provider = 'youtube') as youtube_url,
    max(te.external_url) filter (where te.provider = 'apple_music') as apple_music_url
  from public.track_external_ids te
  where te.track_id = t.id and te.artist_id = t.artist_id
) ids on true;

grant select on public.release_read_model, public.track_read_model to authenticated;
grant select on public.release_read_model, public.track_read_model to anon;
