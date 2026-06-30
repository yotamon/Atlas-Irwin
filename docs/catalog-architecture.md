# Atlas Irwin Catalog Architecture

Supabase is the canonical source of truth for public releases, tracks, media, platform links, homepage placement, and publishing state.

## Data model

- `releases` — publishing fields (`publish_state`, `is_public`, `published_at`, `homepage_eligible`, `active_release`)
- `tracks` — ordered tracks with preview URLs and platform links
- `media_assets` — uploaded files in `public-media` or `studio-private`
- `media_links` — attach assets to releases, tracks, or content items by role
- `track_external_ids` — stable SoundCloud/Spotify/ISRC/YouTube mappings
- `release_external_links` — release-level platform URLs
- `homepage_placements` — homepage player ordering, default track, placement type

Legacy filesystem manifests under `public/releases/` are import input only. They are not read at runtime by the homepage player.

## Storage buckets

| Bucket | Visibility | Purpose |
|--------|------------|---------|
| `public-media` | Public read | Artwork, canvas videos, audio previews, social assets |
| `studio-private` | Admin only | Masters, stems, unreleased production files |
| `studio-assets` | Admin only | Existing Studio uploads |

Public visitors can only read objects in `public-media`. Private buckets remain admin-scoped by owner folder prefix.

## Environment variables

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server catalog queries and import tooling
- `STUDIO_ADMIN_EMAILS` — Studio admin access

Recommended:

- `PUBLIC_CATALOG_OWNER_ID` — explicit owner UUID for public homepage catalog
- `STUDIO_IMPORT_ADMIN_EMAIL` — admin profile used by legacy import script

## Legacy import

Import existing `public/releases` folders into Supabase without modifying legacy files:

```bash
npm run studio:import:dry-run
npm run studio:import
```

The importer:

1. Reads each `release.json`
2. Upserts releases, tracks, external links, homepage placements
3. Uploads eligible public assets to `public-media`
4. Dedupes uploads by SHA-256 hash
5. Flags large audio as suspicious instead of treating it as public master

## Homepage publishing

1. Publish a release (`publish_state = live`, `is_public = true`)
2. Enable a row in `homepage_placements`
3. Choose default track, placement type, and display order in the release Website tab
4. Studio mutations call `revalidateTag("public-catalog")` so `/` updates without redeploying

## SoundCloud and Spotify reconciliation

- Sync updates staging tables only (`soundcloud_tracks`, `spotify_tracks`, `spotify_albums`)
- Unmatched items stay `reconcile_status = pending`
- Studio actions:
  - Link to existing track
  - Create track in existing release
  - Create new release intentionally
  - Dismiss unmatched item
- Metrics resolve through linked track/release IDs or track URLs, not release URL equality alone

## Rollback strategy

1. Keep `public/releases/` untouched
2. Disable homepage placements or set `publish_state = draft`
3. Re-run legacy import after schema changes if needed
4. Revert application deploy if required; database migration is additive and non-destructive

## Manual follow-up

1. ~~Apply migration `20260701000000_catalog_publishing_system.sql` to Supabase~~ (applied)
2. Set `PUBLIC_CATALOG_OWNER_ID` in production
3. Run `npm run studio:import` once after migration (optional if releases already exist in Supabase)
4. Review unmatched SoundCloud/Spotify items in Connections
5. Confirm homepage player on `/` after publishing and placement
