alter table public.track_vault
  add column if not exists media_asset_id uuid references public.media_assets(id) on delete set null;

create unique index if not exists track_vault_owner_media_asset_uidx
  on public.track_vault(owner_id, media_asset_id)
  where media_asset_id is not null;
