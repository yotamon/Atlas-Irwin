# Ensemblis ownership migration matrix

Status: living architecture record for #48, #70 and #71.

The migration is not a mechanical `owner_id → artist_id` rename. Each durable entity has one canonical ownership level and may retain compatibility fields while callers migrate.

## Ownership levels

| Level | Meaning | Examples |
| --- | --- | --- |
| Profile | authenticated human/account identity | `profiles`, auth bootstrap |
| Workspace | shared administrative container | memberships, future billing/team permissions, reusable credentials where appropriate |
| Artist | creative/project identity and all artist-specific truth | releases, tracks, music intelligence, campaigns, audience/growth memory |
| Parent-derived | does not choose its own artist; must inherit from a canonical parent | lyric revisions, stems, Audio Scenes, external track IDs |
| Shared asset | reusable binary/resource may be workspace/profile-owned while usages are artist-scoped | `media_assets` during current transition |

## Core foundation

| Entity | Canonical scope | Current transition state | Rule |
| --- | --- | --- | --- |
| `profiles` | Profile | final | Authentication identity is never an artist. |
| `workspaces` | Workspace | final foundation | Administrative/team boundary. |
| `workspace_memberships` | Workspace | final foundation | Membership and role boundary. |
| `artists` | Artist | final foundation | One workspace may contain many artists. |

New profiles are provisioned idempotently with one personal workspace, owner membership and default artist. This preserves existing Studio onboarding while giving every future row a valid Ensemblis ownership root.

## Music domain — #70

| Entity | Canonical scope | Source of `artist_id` | Compatibility |
| --- | --- | --- | --- |
| `releases` | Artist | explicit active artist; legacy default fallback | retains `owner_id`; legacy `artist` display label mirrors artist name |
| `tracks` | Parent-derived | release | retains `owner_id` |
| `track_music_intelligence` | Parent-derived | track | retains `owner_id` |
| `track_lyrics` | Parent-derived | track | retains `owner_id` |
| `track_lyrics_revisions` | Parent-derived | canonical lyrics | retains `owner_id` |
| `track_lyric_sections` | Parent-derived | canonical lyrics | retains `owner_id` |
| `track_lyric_lines` | Parent-derived | canonical lyrics | retains `owner_id` |
| `track_lyrics_analysis` | Parent-derived | canonical lyrics | retains `owner_id` |
| `track_lyric_moments` | Parent-derived | track | retains `owner_id`; will later feed first-class Moments |
| `track_stems` | Parent-derived | track | retains `owner_id` |
| `audio_scenes` | Parent-derived | track | retains `owner_id` |
| `track_stem_jobs` | Parent-derived | track | retains `owner_id`; worker lineage must remain explicit |
| `track_external_ids` | Parent-derived | track | retains `owner_id` |
| `release_external_links` | Parent-derived | release | retains `owner_id` |
| `homepage_placements` | Parent-derived | release | retains `owner_id` during Atlas public-site compatibility |
| `media_links` targeting Release/Track | Parent-derived | release or track | `artist_id` required for music targets; content-only links remain nullable until #71 |

### Music-domain invariants

1. A child may not override its parent's artist.
2. Parent/child artist mismatch raises an error rather than being silently repaired.
3. Existing Atlas IDs and public routes do not change.
4. `artist_id` is non-null after deterministic backfill for canonical music rows and music-targeting media links.
5. Artist deletion is restricted; artists should be archived instead of cascading catalog deletion.
6. A rename of the canonical Artist updates the temporary `releases.artist` compatibility label.
7. Server actions validate the active Artist Context in addition to workspace membership.
8. Release slugs are unique per Artist, not per profile, so two Artists managed by one account may use the same slug safely.
9. The single-active-release invariant is Artist-local. Activating a release for Artist B must not mutate Artist A.
10. The legacy Atlas public catalog resolves one explicit legacy/default Artist before reading releases, tracks, placements or external music identities.

## Media ownership

`media_assets` intentionally remains owner/profile compatible in #70.

Reason: an uploaded logo, press image, source video or reusable creative asset may legitimately be shared between multiple artists in a workspace. Forcing every binary to one artist would create duplication and make future label/team workflows worse.

The intended model is:

`workspace/profile-owned asset → artist-scoped link or usage → release/track/content`

For #70, `media_links` attached to a Release or Track inherit and validate that music parent's `artist_id`. Content-only media links remain nullable until content ownership moves in #71. Before general multi-artist media sharing is exposed, access checks must still prevent a user from linking an asset from a workspace they cannot access.

## Brand / Artist Intelligence boundary

`brand_settings` remains on its legacy profile scope in #70 because the current music-analysis graph does not consume it. Track Intelligence, Lyrics Intelligence, Stem Intelligence and Audio Scenes are derived from the canonical Track/Lyrics/Stem graph, not from `brand_settings`.

When brand, marketing and creative-generation surfaces move in #71, artist-specific brand identity must move with them. This is an intentional boundary, not an omission from the music migration. Product-level model/provider configuration may remain broader when it is genuinely shared.

## Operational domain — #71

These entities become artist-scoped after the music graph is proven:

- artist-specific brand settings and creative identity;
- campaigns and phases;
- content items and creative lineage;
- publication jobs and provider scheduling;
- metric snapshots and attribution;
- growth settings, vault, plans and opportunities;
- social connections where the connected identity belongs to one artist;
- audience interactions and outreach;
- automation jobs and event streams;
- creative spend envelopes and paid-generation jobs;
- next-best-actions and performance learnings.

Every durable background/external-effect job must carry explicit `artist_id`; service-role workers must validate parent lineage because service credentials can bypass RLS.

## Workspace/account-scoped candidates

The following should not automatically become artist-scoped without a domain-specific reason:

- user authentication/session data;
- workspace membership and roles;
- future billing/subscription records;
- provider credentials that are genuinely shared across a workspace;
- reusable media binaries;
- product-level model/provider configuration when intentionally shared.

Provider connections require case-by-case classification. A Spotify/SoundCloud/social identity representing one artist should be artist-scoped even if its OAuth credential is stored at a broader secure scope.

## Migration gates

A domain may switch reads from `owner_id` to `artist_id` only when:

- deterministic backfill is complete;
- parent consistency is enforced in the database;
- RLS is covered;
- direct deep links are artist-scoped;
- Server Actions validate active artist context;
- service/background paths retain explicit lineage;
- a same-user, second-artist adversarial test passes;
- Atlas production compatibility is preserved.

`owner_id` is removed or demoted only after every downstream consumer has crossed those gates.