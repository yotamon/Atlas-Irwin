-- Cover foreign-key lookup paths for mastering reference lifecycle operations.
-- These indexes are intentionally partial because both foreign keys are nullable.

create index if not exists mastering_references_track_vault_idx
  on public.mastering_references(track_vault_id)
  where track_vault_id is not null;

create index if not exists mastering_references_media_asset_idx
  on public.mastering_references(media_asset_id)
  where media_asset_id is not null;
