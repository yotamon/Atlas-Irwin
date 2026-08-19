-- First-class Atlas Irwin brand references for cohesive AI creative generation.
-- These are owner-level library assets. They do not need a media_links parent until
-- they are reused in a release or content item.

alter type public.media_asset_type add value if not exists 'brand_reference';
alter type public.media_asset_type add value if not exists 'brand_logo';
alter type public.media_asset_type add value if not exists 'brand_motion_reference';
