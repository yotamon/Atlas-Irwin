# Atlas Irwin Catalog Architecture

Supabase is the canonical source of truth for public releases, tracks, media, platform links, homepage placement, and publishing state.

## Data model

- `releases` — publishing fields (`publish_state`, `is_public`, `published_at`, `homepage_eligible`, `active_release`)
- `tracks` — ordered tracks with preview URLs and platform links
- `media_assets` — uploaded files in the public `public-media` library
- `media_links` — attach assets to releases, tracks, or content items by role
- `track_external_ids` — stable SoundCloud/Spotify/ISRC/YouTube mappings
- `release_external_links` — release-level platform URLs
- `homepage_placements` — homepage player ordering, default track, placement type

Legacy filesystem manifests under `public/releases/` are import input only. They are not read at runtime by the homepage player.

## Storage buckets

| Bucket | Visibility | Purpose |
|--------|------------|---------|
| `public-media` | Public read | Artwork, canvas videos, audio, social assets, masters, and stems |
| `studio-assets` | Admin only | Legacy Studio uploads outside the media library |

Every media-library upload is intentionally public and receives a stable public URL.

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

The Studio preview at `/studio/homepage-preview` renders the same `ReleaseWidgetClient`
and `getPublicReleases()` result as the public homepage. Compact previews in Command
Center and the Release Workspace are mapped from that same public catalog result and
expose the current artwork, CTA, default track, and placement order.

## Artist operating system routes

- `/studio` — Command Center for the active release, prioritized attention queue,
  live catalog preview, seven-day runway, and real-metric pulse
- `/studio/releases/[id]` — release workspace with Overview, Music, Media, Website,
  Campaign, and Performance surfaces
- `/studio/campaigns` — release-centered content and outreach workload in list or
  calendar form; it composes existing content and outreach records rather than
  duplicating campaign state
- `/studio/media` — global asset inventory, usage map, deduplicated upload, and
  attach-to-release workflow
- `/studio/data-health` — auditable reconciliation, metadata, media, platform-link,
  placement, legacy-import, and stale-sync checks

## Deterministic readiness

`lib/studio/readiness.ts` is the single readiness calculation used by Command Center
and Release Workspace. Each check is explicit, links to its fix location, and is
classified as either a publishing blocker or a marketing recommendation. Optional
campaign work never prevents publishing.

## Media upload safety

Media files upload directly to `public-media` through short-lived signed upload grants,
so large video and audio files do not pass through a server-action request body. Files
up to 128 MB receive a browser-side SHA-256 fingerprint; an existing asset with the same
owner and hash is reused. Every asset receives a stable public URL, including masters
and stems, and the application does not expose a private-media state.

### Reuse and future AI provenance

`media_assets` represents the stored source file. `media_links` represents each use of
that file (release, track, or content item), including its role, primary status, alt text,
and caption. Tags, creative notes, original filename, source kind, and upload provenance
live in asset metadata. Keeping files separate from their uses means a single asset can
be release artwork, a campaign reference, and a future model input without duplication.

When AI generation is added, preserve this boundary: add generation-job records and a
directed source-to-output relation table rather than copying prompt or model history into
release records. Each output should be a normal `media_assets` row with immutable
provenance (provider, model, parameters, prompt version, source asset IDs, consent/rights
state, and generation timestamp). Human-approved role assignments should remain explicit
`media_links`; a generated output must never silently replace public artwork.

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

## Security

- Never commit `.env*` files (except `.env.example`) or `supabase/.temp/`.
- Keep `SUPABASE_SERVICE_ROLE_KEY`, OAuth secrets, and Studio passwords server-only.
- See [`SECURITY.md`](../SECURITY.md) for vulnerability reporting.
