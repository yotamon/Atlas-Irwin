# Ensemblis Multi-Artist Architecture RFC

**Status:** Proposed / implementation-ready foundation  
**Roadmap:** `docs/ensemblis-product-roadmap.md`  
**Tracking:** #48  
**Primary constraint:** Preserve the existing Atlas Irwin production tenant throughout migration.

## 1. Problem

The original Atlas Release Engine was built for one artist operated by one authenticated owner. The schema therefore uses `owner_id -> profiles.id` across core artist data, and the application frequently scopes queries with `owner_id = user.id`.

That was valid for the original product, but it is not a valid ownership model for Ensemblis.

Ensemblis needs to support:

- one person managing one artist;
- one person managing multiple artists;
- managers/creative/marketing collaborators working on an artist;
- a team or label managing a roster;
- role-scoped access without cross-artist leakage;
- background/automation work that always knows exactly which artist it belongs to.

The architectural separation is:

`user identity != workspace != artist`

## 2. Target hierarchy

```text
profiles
  └─ workspace_memberships
       └─ workspaces
            └─ artists
                 ├─ releases
                 │    └─ tracks
                 ├─ brand / Artist Intelligence
                 ├─ connections
                 ├─ campaigns
                 ├─ content / creative
                 ├─ audience
                 ├─ growth
                 ├─ metrics / learnings
                 └─ automation / autonomy contracts
```

A user receives access to an artist through workspace membership plus optional artist-level restrictions. The default first implementation may allow every workspace member to access every artist, while the schema should leave room for artist-level grants without requiring another ownership rewrite.

## 3. Proposed foundation tables

### `workspaces`

Represents the administrative/team boundary.

Suggested fields:

- `id uuid pk`
- `name text`
- `slug text`
- `kind text` (`personal`, `team`, `label` initially)
- `created_by uuid -> profiles.id`
- `created_at`, `updated_at`

### `workspace_memberships`

Represents human access to a workspace.

Suggested fields:

- `workspace_id`
- `profile_id`
- `role` (`owner`, `admin`, `manager`, `creative`, `marketing`, `analyst`, `viewer`)
- `status` (`active`, `invited`, `suspended`)
- timestamps
- unique `(workspace_id, profile_id)`

### `artists`

Represents the actual artist/project identity managed by Ensemblis.

Suggested fields:

- `id uuid pk`
- `workspace_id uuid not null`
- `name text not null`
- `slug text not null`
- `project_type` (`human`, `ai_assisted`, `hybrid`, `virtual_persona`) with intentionally neutral default
- `status` (`active`, `paused`, `archived`)
- `avatar_url`, `accent_color`
- timestamps
- unique `(workspace_id, slug)`

Artist Identity / Artist Intelligence should not be expanded into a giant `artists` row. Existing and future structured identity data can live in dedicated artist-scoped tables/documents.

### Optional future `artist_memberships`

Do not require this for the first migration unless necessary. Add it when a workspace must restrict a member to a subset of artists.

## 4. Compatibility strategy

Do **not** replace every `owner_id` in one migration.

Use a transitional ownership model:

```text
owner_id     = authenticated/account compatibility scope
artist_id    = canonical artist scope
workspace_id = administrative/team scope when required directly
```

During the migration, old code may continue to query `owner_id` while migrated domains require and validate `artist_id`.

After all artist-scoped domains use `artist_id`, `owner_id` can be demoted to audit/legacy compatibility or removed where it adds no value.

## 5. Migration phases

### A. Inventory and invariants

Before database mutation, produce an audit of:

- every table containing `owner_id`;
- every RLS policy using `auth.uid()` as owner identity;
- every server query filtering by current user rather than active artist;
- service-role/background jobs that infer tenant only from `owner_id`;
- storage paths beginning with user ID;
- hardcoded Atlas copy/defaults/prompts that actually represent artist context.

Categorize each object:

1. account/workspace-scoped;
2. artist-scoped;
3. release/track-scoped (artist derivable through parent but sometimes worth denormalizing);
4. global/system-scoped.

### B. Add workspace and artist foundations

Create the new tables and supporting functions/policies without modifying existing product tables.

This migration should be safe to deploy even if the application ignores the new tables.

### C. Backfill the existing tenant

For each existing authorized production owner:

1. create a default workspace;
2. add the owner membership;
3. create the correct artist record;
4. for this repository's existing real production tenant, the artist is Atlas Irwin;
5. record a deterministic mapping from legacy owner to default workspace/artist.

Backfill logic must be idempotent. Re-running migrations/tests must not create duplicate artists or workspaces.

### D. Introduce an application `ArtistContext`

Create one server-owned resolver that returns something conceptually like:

```ts
type ArtistContext = {
  userId: string;
  workspaceId: string;
  artistId: string;
  artistName: string;
  role: WorkspaceRole;
};
```

Rules:

- generic Studio code should not rediscover artist ownership independently;
- server actions/background entry points receive or resolve explicit artist context;
- client-provided `artist_id` is never trusted without membership validation;
- if an artist is ambiguous, fail closed rather than silently choosing another artist.

The first compatibility implementation can resolve the user's default artist so existing URLs continue working.

### E. Migrate domains in controlled slices

Recommended order:

1. Artist Identity / brand settings;
2. Releases and tracks;
3. Track/Lyrics/Stem intelligence;
4. Moments;
5. Campaigns/content/creative/media lineage;
6. Connections and social accounts;
7. Metrics/growth/learnings;
8. Audience/outreach;
9. automation, jobs, next-best-actions and autonomy contracts;
10. storage and remaining support tables.

For each domain:

- add `artist_id` nullable;
- backfill from known owner/default-artist mapping or parent object;
- add FK/indexes;
- dual-write if old code still creates rows;
- update reads to active artist;
- update RLS;
- make `artist_id` non-null only after verification;
- remove compatibility logic only after all producers are migrated.

Avoid permanently duplicating `workspace_id` on every artist table when `artist_id -> workspace_id` is sufficient. Denormalize only where required for security, performance or durable job execution.

## 6. Authorization and RLS

The current admin model is based around an authenticated profile and admin allowlist. Ensemblis should move toward membership authorization without weakening existing production restrictions during transition.

Target helper concepts:

- `private.is_workspace_member(workspace_id)`
- `private.can_access_artist(artist_id)`
- `private.can_manage_artist(artist_id)`
- role-aware checks for money/settings/team administration

Policy shape for an artist-scoped table:

```text
row.artist_id -> artists.workspace_id
workspace_memberships(profile_id = auth.uid(), workspace_id, active)
```

Security requirements:

- no cross-workspace reads;
- no cross-artist writes without access;
- service-role automation validates artist/workspace invariants explicitly because RLS may be bypassed;
- membership removal immediately blocks future authenticated access;
- invitations do not grant data access before activation.

## 7. Background jobs and automation

This is a critical migration surface.

Every durable job created after its domain migrates should carry explicit artist context. Do not infer artist at execution time solely from the currently authenticated user because cron/worker execution has no meaningful interactive user.

Preferred lineage:

`job -> artist_id -> workspace_id`

and, where applicable:

`job -> campaign/content/release -> artist_id`

At claim/execution time validate that linked objects agree on the same artist. A mismatched lineage is a data-integrity failure, not something to auto-repair by guessing.

## 8. Storage

Legacy private storage currently uses user-scoped paths. Do not bulk-move production assets just to make URLs pretty.

Target new writes should use a stable hierarchy such as:

```text
workspace/{workspace_id}/artist/{artist_id}/...
```

Migration strategy:

- preserve readable legacy paths;
- add a storage abstraction that resolves old and new assets;
- new writes use artist-scoped paths;
- only migrate physical objects when there is an operational reason;
- update storage policies before enabling non-admin multi-user access.

## 9. URLs and active artist selection

Avoid making correctness depend only on browser-local "current artist" state.

Two acceptable models:

### Artist in route
`/studio/artists/{artistSlug}/releases/...`

Strong explicit context and deep links, but a larger route migration.

### Artist in validated session/context
Keep existing URLs initially and store the selected artist server-side or in a signed/validated preference.

Recommended migration:

1. preserve existing `/studio/...` URLs for Atlas compatibility;
2. introduce a visible artist switcher;
3. resolve active artist through server validation;
4. consider artist-explicit canonical URLs when multi-artist UX is stable.

Deep links must never open an object from an artist the user cannot access.

## 10. Atlas Irwin migration invariant

Atlas Irwin is the first Ensemblis artist, not a legacy special case in product logic.

The migration is successful when:

- Atlas has a normal `artists.id`;
- its releases/tracks/identity/connections all resolve through that artist;
- generic Ensemblis surfaces use `artist.name` instead of hardcoded strings;
- Atlas-specific creative rules remain artist data;
- its public catalog/site can continue operating during the Ensemblis product migration.

Do not preserve convenience by adding code such as `if (artist === Atlas)`. If a generic feature needs Atlas-specific behavior, that behavior belongs in artist configuration or data.

## 11. Test strategy

The multi-artist foundation is not done without an adversarial second-artist fixture.

Minimum test matrix:

- owner can access Atlas;
- owner can create/access Artist B;
- Artist B sees none of Atlas's releases/content/intelligence;
- switching artist changes Today/queries deterministically;
- invalid/tampered artist IDs fail;
- workspace viewer cannot perform management actions;
- background job with mismatched artist lineage fails;
- backfill is idempotent;
- legacy Atlas data remains unchanged;
- clean Supabase migration replay passes;
- database/RLS tests pass.

## 12. Rollout gates

### Gate 1 — Foundation exists, unused
New workspace/artist tables and RLS land without behavior change.

### Gate 2 — Atlas mapped
Production Atlas tenant has canonical workspace/artist mapping; old app still behaves identically.

### Gate 3 — Context resolver
Generic app shell can read active artist through one trusted context abstraction.

### Gate 4 — Core music domain migrated
Releases/tracks/intelligence use artist scope. Second artist works for music/catalog without leakage.

### Gate 5 — Growth/marketing migrated
Campaigns/content/performance/automation use artist scope.

### Gate 6 — Multi-artist UX enabled
Artist switcher/roster becomes user-visible only after domain isolation is complete enough that switching cannot expose partially scoped screens.

### Gate 7 — Legacy ownership cleanup
Only after evidence shows no production dependency on owner-as-artist semantics.

## 13. Explicit non-goals for the first P0 slice

- billing/plans;
- public self-serve signup redesign;
- label financial accounting;
- complex artist-level permission matrices;
- moving every existing storage object;
- rewriting all URLs;
- renaming every `owner_id` immediately;
- product visual rebrand before ownership correctness exists.

## 14. First implementation slice

The first code PR for #48 should be deliberately small:

1. additive workspace / membership / artist schema;
2. idempotent existing-tenant mapping strategy;
3. RLS helpers/tests for new tables;
4. typed server resolver for current/default artist;
5. no broad product-table migration yet;
6. CI clean migration replay and DB tests required.

This gives the rest of Ensemblis a safe ownership primitive before Moments, learning, rebrand UX or provider integrations are layered on top.