# Atlas Irwin Catalog Architecture

Supabase is the sole canonical source of truth for public releases, tracks, media, platform links, homepage placement, and publishing state.

The filesystem catalog migration was completed and retired on 2026-09-16. Historical files under `public/releases/` remain only as frozen URL-compatibility assets. Runtime code, Studio, imports, and publishing must not read them as catalog data.

## Data model

- `releases` — publishing fields (`publish_state`, `is_public`, `published_at`, `homepage_eligible`, `active_release`)
- `tracks` — ordered tracks with preview URLs and platform links
- `media_assets` — uploaded files in the public `public-media` library
- `media_links` — attach assets to releases, tracks, or content items by role
- `track_external_ids` — stable SoundCloud/Spotify/ISRC/YouTube mappings
- `release_external_links` — release-level platform URLs
- `homepage_placements` — homepage player ordering, default track, placement type

Every public release is artist-scoped. Public catalog queries always resolve an artist and filter artist-scoped music tables by `artist_id`.

## Archived release files

`public/releases/` is not an import source or catalog. Existing release folders are retained only because old `/releases/...` URLs may still be referenced externally.

Rules:

1. Do not add new release folders or manifests.
2. Do not read this directory from application runtime code.
3. Do not use it as a fallback for artwork, Canvas video, audio, or metadata.
4. Treat existing files as immutable until their public URLs can be formally retired.

`scripts/check-no-filesystem-catalog-compat.mjs` enforces the runtime boundary during development, tests, and builds.

## Storage buckets

| Bucket | Visibility | Purpose |
|--------|------------|---------|
| `public-media` | Public read | Artwork, canvas videos, audio, social assets, masters, and stems |
| `studio-assets` | Admin only | Historical Studio uploads outside the media library |

Every media-library upload is intentionally public and receives a stable public URL.

## Environment variables

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server catalog queries and operational tooling
- `STUDIO_ADMIN_EMAILS` — Studio admin access

Recommended:

- `PUBLIC_CATALOG_OWNER_ID` — explicit owner UUID for public homepage catalog
- `PUBLIC_CATALOG_ARTIST_ID` — explicit artist UUID when an owner has more than one live public artist

## Homepage publishing

1. Publish a release (`publish_state = live`, `is_public = true`)
2. Enable a row in `homepage_placements`
3. Choose default track, placement type, and display order in the release Website tab
4. Studio mutations call `revalidateTag("public-catalog")` so `/` updates without redeploying

The Studio preview at `/studio/homepage-preview` renders the same `ReleaseWidgetClient` and `getPublicReleases()` result as the public homepage. Compact previews in Command Center and the Release Workspace are mapped from that same public catalog result and expose the current artwork, CTA, default track, and placement order.

## Artist operating system routes

- `/studio` — artist-specific Today view with operating snapshot, current mission, decision queue, and upcoming work
- `/studio/releases/[id]` — release workspace with Overview, Music, Media, Website, Campaign, and Performance surfaces
- `/studio/campaigns` — artist-specific campaigns, experiments, content variants, and publication jobs
- `/studio/content` — artist-specific Content Lab with kanban/list views
- `/studio/tasks` — owner-scoped task CRUD
- `/studio/media` — global asset inventory, usage map, deduplicated upload, and attach-to-release workflow
- `/studio/outreach` — relationship CRM and follow-up timeline
- `/studio/spotify` / `/studio/soundcloud` — platform sync and reconciliation hubs
- `/studio/analytics` — artist-specific growth funnel, goal-weighted content, campaign metrics, and learnings
- `/studio/brand` — artist-specific creative guardrails and visual references
- `/studio/data-health` — auditable reconciliation, metadata, media, platform-link, placement, and stale-sync checks
- `/studio/calendar` — artist-specific content calendar with month, week, and list views

## Deterministic readiness

`lib/studio/readiness.ts` is the single readiness calculation used by Command Center and Release Workspace. Each check is explicit, links to its fix location, and is classified as either a publishing blocker or a marketing recommendation. Optional campaign work never prevents publishing.

## Media upload safety

Media files upload directly to `public-media` through short-lived signed upload grants, so large video and audio files do not pass through a server-action request body. Files up to 128 MB receive a browser-side SHA-256 fingerprint; an existing asset with the same owner and hash is reused. Every asset receives a stable public URL, including masters and stems, and the application does not expose a private-media state.

### Reuse and future AI provenance

`media_assets` represents the stored source file. `media_links` represents each use of that file (release, track, or content item), including its role, primary status, alt text, and caption. Tags, creative notes, original filename, source kind, and upload provenance live in asset metadata. Keeping files separate from their uses means a single asset can be release artwork, a campaign reference, and a future model input without duplication.

When AI generation is added, preserve this boundary: add generation-job records and a directed source-to-output relation table rather than copying prompt or model history into release records. Each output should be a normal `media_assets` row with immutable provenance (provider, model, parameters, prompt version, source asset IDs, consent/rights state, and generation timestamp). Human-approved role assignments should remain explicit `media_links`; a generated output must never silently replace public artwork.

## SoundCloud and Spotify reconciliation

- Sync updates staging tables only (`soundcloud_tracks`, `spotify_tracks`, `spotify_albums`)
- Unmatched items stay `reconcile_status = pending`
- Studio actions intentionally link or create canonical releases/tracks
- Metrics resolve through linked track/release IDs or track URLs, not release URL equality alone

## Rollback strategy

Catalog rollback happens inside the canonical model:

1. Disable homepage placements or set `publish_state = draft`.
2. Restore or relink the relevant canonical `media_assets` / `media_links` record if media is wrong.
3. Revert the application deploy if application code is faulty.
4. Never reactivate the filesystem manifests as a runtime fallback.

Historical Supabase migration files remain immutable database history even when their names reference older or legacy states.

## Ops checklist

1. Migrations applied, including catalog publishing, media integrity, artist scoping, and filesystem-catalog retirement
2. `PUBLIC_CATALOG_OWNER_ID` and `PUBLIC_CATALOG_ARTIST_ID` explicit where ownership is ambiguous
3. All public media resolves through canonical `media_assets` / `media_links`
4. Unmatched SoundCloud/Spotify items reviewed in Connections after each sync
5. Homepage player on `/` verified after publish + placement changes
6. `npm run check:legacy-runtime` passes

## Security

- Never commit `.env*` files (except `.env.example`) or `supabase/.temp/`.
- Keep `SUPABASE_SERVICE_ROLE_KEY`, OAuth secrets, and Studio passwords server-only.
- See [`SECURITY.md`](../SECURITY.md) for vulnerability reporting.
