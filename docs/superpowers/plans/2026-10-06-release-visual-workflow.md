# Release Visual — Implementation Plan

**Issue:** #289  
**Spec:** `docs/superpowers/specs/2026-10-06-release-visual-workflow-design.md`  
**Execution shape:** one draft PR, implemented task-by-task until all acceptance gates pass.

## Principle

Do not build "Promo Artwork" as a separate product.

Evolve the existing `visual` Create family into a release-first static design workflow and preserve Living Artwork as its optional motion continuation.

The implementation should reuse existing Create, Release, Media Library, Visual Brand DNA, Creative Derivatives, generation lineage, Today/Continue and Launcher contracts.

---

## Task 1 — Establish the Release Visual domain contract

### Add

- `lib/marketing/release-visual.ts`
- `tests/release-visual-contract.test.mjs`

### Modify

- `lib/studio/create-outcomes.ts`
- `lib/studio/creative-directions.ts`

### Contract

Define:

- `RELEASE_VISUAL_WORKFLOW = "release_visual"`
- stages:
  - `source`
  - `message`
  - `design`
  - `review`
  - `use`
- message intents:
  - `clean`
  - `out_now`
  - `out_friday`
  - `pre_save`
  - `listen_now`
  - `custom`
- layout IDs:
  - `cover_focus`
  - `editorial_split`
  - `full_bleed`
  - `minimal_frame`
- `ReleaseVisualSpec`
- canonical media roles
- stage derivation helpers
- release-lifecycle-based default message intent

Extend Create outcomes with:

```ts
sourceMode: "moment" | "release";
```

Change only `visual` to `sourceMode: "release"` and `workflow: "release_visual"`.

Keep outcome ID `visual` for compatibility.

### Creative direction behavior

`recommendCreativeDirections()` must rank only Moment-owned outcomes.

Release Visual is not scored against hook/energy/vocal features.

### Tests

Lock:

- `visual` remains the same ID;
- visual is release-owned;
- moment recommender excludes release-owned outcomes;
- lifecycle defaults never invent dates;
- Release Visual stages are derived, not separately persisted.

---

## Task 2 — Make Create source-aware

### Modify

- `app/studio/(protected)/create/page.tsx`
- `app/studio/create-actions.ts`
- `tests/ensemblis-ux-v5-contract.test.mjs` or focused Create contract test

### Create page

Split candidate presentation into:

1. Moment-owned creative directions;
2. Release-owned visual action.

The Release Visual card should show:

- cover preview;
- release title;
- release date/lifecycle when known;
- visual outcome copy;
- one CTA: **Create visual**.

Do not show:

- "Ensemblis picked" Moment copy;
- a track preview;
- a fake musical rationale.

When `outcome=visual` is requested, prioritize the release-owned card.

### Start action

Refactor `startOutcomeCreative` into two safe branches.

#### Moment source

Preserve existing behavior for Reach / Streams / Lyric.

#### Release source

Accept:

- `artist_id`
- `release_id`
- `outcome=visual`

Do not require `moment_id`.

Create one content item:

- linked to the release/campaign;
- no moment required;
- no audio window required;
- `production_notes` contains a compatibility marker `[release-visual:v1]`;
- status Draft;
- approval not required until a visual is selected.

Redirect:

```
/studio/create/visual/<contentItemId>
```

### Failure states

If release artwork is absent, still allow workflow creation and land in Source with a clear blocker.

Do not fail the entire visual workflow just because no Moment exists.

---

## Task 3 — Add static-image social packages and design context

### Modify

- `lib/marketing/platform-packages.ts`
- `lib/brand/visual-brand-dna.ts` only if a small derived helper is useful
- `lib/brand/visual-brand-store.ts` only if workspace loading needs a bounded helper
- focused package tests

### Add packages

- `instagram-story-image`
  - Instagram
  - Story
  - image
  - 1080 × 1920
  - 9:16
  - safe area authoritative

- `instagram-square`
  - Instagram
  - Feed Post / Square
  - image
  - 1080 × 1080
  - 1:1

Reuse:

- `instagram-feed-portrait`

Do not duplicate dimensions in UI components.

### Layout ranking

Add a pure function that ranks deterministic layout presets from:

- package aspect ratio;
- Visual Brand DNA spectrum/composition/typography guidance;
- source dimensions if known;
- message intent.

Ranking must be bounded and deterministic.

Visual Brand DNA can alter ranking/style tokens, not the release source.

---

## Task 4 — Build the Release Visual workspace and route

### Add

- `app/studio/(protected)/create/visual/[id]/page.tsx`
- `lib/marketing/release-visual-workspace.ts`
- `components/studio/release-visual-workflow.tsx`
- optionally focused subcomponents under `components/studio/release-visual/`

### Workspace responsibilities

Load artist-scoped:

- content item;
- release;
- campaign;
- release cover;
- eligible selected visual source;
- active Visual Brand DNA;
- latest selected Release Visual generation lineage;
- rendered Release Visual assets;
- derivative state;
- explicit Living Artwork source;
- latest errors/retry state.

Derive current stage from canonical state.

Do not store a separate `release_visual_stage` column/table.

### UI

Use canonical `WorkflowStepper`.

Stages:

1. Source
2. Message
3. Design
4. Review
5. Use

Mobile layout is first-class.

Default UI exposes no provider/model terminology.

---

## Task 5 — Implement zero-spend deterministic composition

### Add

- `lib/marketing/release-visual-layout.ts`
- `components/studio/release-visual-composer.tsx`
- `app/studio/release-visual-actions.ts`
- focused rendering/spec tests

### Pure layout engine

Given:

- `ReleaseVisualSpec`
- `SocialPlatformPackage`
- source dimensions

return a normalized geometry plan:

- background bounds;
- source cover bounds;
- text zones;
- alignment;
- font scale classes;
- contrast treatment;
- safe-area bounds.

No DOM-specific values in the domain output.

### Browser Canvas renderer

The client component should:

1. fetch the approved source;
2. await required app font readiness;
3. render the selected layout;
4. render exact deterministic copy;
5. validate geometry;
6. export PNG;
7. upload through a server action.

The preview must use the same layout plan as final rasterization.

### V1 layouts

- Cover focus
- Editorial split
- Full bleed
- Minimal frame

### Renderer safety

Fail closed when:

- source cannot be decoded;
- final dimensions mismatch;
- required text overflows;
- geometry is invalid;
- fonts required for final output are unavailable.

Preview may show a temporary fallback, but final approval cannot persist a mismatched render.

### No generative spend

Do not call image/video providers in this task.

---

## Task 6 — Persist selected spec, assets and approval lineage

### Modify / Add

- `app/studio/release-visual-actions.ts`
- `lib/marketing/release-visual-workspace.ts`
- `types/*` only where typed helper extensions are needed
- Media Library tests

### On approval

Create/reuse one deterministic `generation_runs` entry:

- provider: `ensemblis-compositor`
- model: `release-visual-v1`
- purpose: `content_asset:<contentItemId>`
- cost: zero
- selected `ReleaseVisualSpec` in `input_context`
- rendered primary asset IDs in output
- quality gate true only after deterministic validation

Register PNG as `media_assets`.

Link with:

- target format role;
- `release_visual_primary` for the selected primary render.

Set `content_items.asset_url` to the current primary raster for compatibility.

Set approval status to approved only after:

- valid spec;
- valid target package;
- successful upload;
- source lineage;
- render validation.

### Event

Emit `release_visual_approved` with normalized enums only.

Do not log custom copy text in marketing event telemetry.

---

## Task 7 — Upgrade Creative Derivatives for real image recomposition

### Modify

- `types/creative-derivative-database.ts`
- `lib/marketing/creative-derivatives.ts`
- add append-only Supabase migration
- derivative tests

### Migration

Extend strategy check with:

```
deterministic_image_recompose
```

Do not rewrite historical migrations.

### Behavior

For Release Visual masters:

- do not reuse the same raster across aspect ratios;
- derive target composition from the approved `ReleaseVisualSpec`;
- render a fresh target raster deterministically;
- keep parent generation/content lineage;
- cost remains zero.

### Initial derivative targets

- Story image
- Feed portrait
- Square

A failed derivative must not invalidate the approved master.

Retry only the failed target package.

---

## Task 8 — Make Living Artwork consume the approved Release Visual

### Modify

- `lib/marketing/living-artwork-workspace.ts`
- `components/studio/living-artwork-loop-kit-prep.tsx`
- `app/studio/living-artwork-actions.ts`
- `components/studio/living-artwork-workflow.tsx`
- `lib/marketing/creative-context.ts` if source ranking needs an explicit role
- Living Artwork contract tests

### Add action

`animateApprovedReleaseVisual`

Contract:

1. validate artist/content ownership;
2. require approved Release Visual spec;
3. resolve/render approved 9:16 Story raster;
4. link the exact asset as `living_artwork_source`;
5. emit `release_visual_animation_started`;
6. redirect to the existing loop route.

### Source resolution order

Living Artwork should prefer:

1. explicit `living_artwork_source`;
2. approved Release Visual Story / primary asset;
3. existing prepared `living_artwork_source_frame`;
4. release cover;
5. other ranked approved references.

### Exact-source bypass

When explicit animation source is already 1080 × 1920:

- skip browser portrait reframing;
- use exact bytes/URL;
- preserve all typography;
- use it as both first and last frame.

For a non-9:16 approved visual:

- render same spec to Story first;
- never crop/reframe the approved raster destructively.

### Content lineage

Use the same `content_item_id`.

Static and motion are sibling media outputs of one visual creative family.

---

## Task 9 — Integrate Release, Launcher and Today / Continue

### Release

Modify the normal Release workspace component(s), likely:

- `components/studio/release-workspace-v2.tsx`

Add contextual action:

**Create visual**

Link:

```
/studio/create?release=<id>&outcome=visual
```

Do not add a new release-specific implementation.

### Action Launcher

Modify:

- `lib/studio/intent/domain.ts`
- `lib/studio/intent/server.ts`
- `tests/ensemblis-intent-resolution.test.mjs`

Extend intent schema with:

```ts
createMode: "static" | "motion" | null
```

Static aliases:

- Out Now Story
- Out Friday artwork
- make this cover fit Instagram
- release post
- release visual

Motion aliases:

- animate this artwork
- loop this cover
- visualizer
- looping visual

Static release intents should resolve to Release Visual.

Motion intents should preserve direct motion intent and either:

- enter the visual family in motion mode; or
- reuse an existing approved visual family and go to Living Artwork.

### Today / Continue

Modify:

- `lib/studio/artist-operating-snapshot.ts`
- `app/studio/(protected)/page.tsx`

Replace Living-Artwork-only continuation with one visual-family continuation.

Never show duplicate cards for the same content item.

Priority within one visual item:

1. unfinished static design;
2. explicit animation continuation;
3. export/reuse state.

---

## Task 10 — Promotion / publication integration

### Verify

Existing:

- `content_items.asset_url`
- publication jobs
- Production compatibility route
- campaign content linkage

can consume the approved static primary asset.

### Rules

- no auto-publish;
- no new scheduling system;
- no new campaign table;
- approved static image should be usable by existing publication preparation;
- animation/video assets remain separate outputs.

If existing publication code assumes one fixed format, adapt via canonical media link roles rather than copying files.

---

## Task 11 — Recovery, provenance and observability

### Telemetry

Add normalized events:

- `release_visual_started`
- `release_visual_message_selected`
- `release_visual_layout_selected`
- `release_visual_rendered`
- `release_visual_approved`
- `release_visual_derivative_rendered`
- `release_visual_animation_started`

No raw custom copy in telemetry.

### Recovery tests

Cover:

- missing cover;
- invalid source;
- source fetch/CORS failure;
- font readiness failure;
- render overflow;
- upload retry;
- duplicate approve click;
- derivative retry;
- page refresh at every stage;
- animation handoff retry;
- legacy Living Artwork item.

### Provenance

Every raster must retain:

- artist ID;
- release ID;
- content item ID;
- source asset ID/URL;
- source role;
- selected spec;
- package ID;
- compositor version;
- Visual Brand version ID when used;
- parent generation run when derivative;
- zero-spend marker.

---

## Task 12 — UX V5 docs, cross-artist acceptance and final validation

### Docs

Update:

- `docs/ensemblis-ux-v5-route-inventory.md`
- `docs/ensemblis-product-roadmap.md`
- any Create/Living Artwork docs made stale by the new static-first contract

### Route inventory

Add `/studio/create/visual/[id]`.

Reword Living Artwork natural discovery to approved visual → Animate / explicit motion intent.

### Cross-artist

Validate both:

- Atlas Irwin: cover-based promo + optional motion;
- non-generative artist policy: full static workflow works with zero generative AI.

### Contract tests

Add / update:

- `tests/release-visual-contract.test.mjs`
- `tests/ensemblis-intent-resolution.test.mjs`
- Create outcome tests
- derivative contract tests
- Living Artwork handoff tests
- migration history guard count if a new migration is added

### Authenticated E2E

Extend `e2e/ensemblis-ux-v5.spec.mjs`.

Desktop and mobile path:

1. open Release / Create;
2. start visual without a Moment;
3. Source shows cover;
4. choose Out Now;
5. choose Story;
6. review deterministic variant;
7. approve;
8. verify Use stage;
9. verify another-format action;
10. verify Animate action reaches Living Artwork with approved static source.

Do not submit a paid generation in E2E.

### Validation matrix

Before merge:

- Studio product contracts;
- TypeScript;
- lint;
- production build;
- database migration guard;
- clean database replay;
- database behavior verification;
- Media Worker regression;
- browser smoke;
- Library Bridge/native CI;
- authenticated Studio acceptance when credentials are available.

---

# Recommended implementation order

1. Domain/source-mode contract
2. Source-aware Create
3. Platform image packages
4. Release Visual route/workspace
5. Deterministic Canvas composer
6. Persistence + approval
7. Image derivative recomposition
8. Living Artwork exact-source handoff
9. Release / Launcher / Today integration
10. Publication compatibility
11. Recovery / provenance / telemetry
12. Docs / E2E / full validation

---

# File-level implementation map

## New

- `lib/marketing/release-visual.ts`
- `lib/marketing/release-visual-layout.ts`
- `lib/marketing/release-visual-workspace.ts`
- `app/studio/(protected)/create/visual/[id]/page.tsx`
- `app/studio/release-visual-actions.ts`
- `components/studio/release-visual-workflow.tsx`
- `components/studio/release-visual-composer.tsx`
- `tests/release-visual-contract.test.mjs`
- append-only migration extending Creative Derivative strategy

## Core modifications

- `lib/studio/create-outcomes.ts`
- `lib/studio/creative-directions.ts`
- `app/studio/(protected)/create/page.tsx`
- `app/studio/create-actions.ts`
- `lib/marketing/platform-packages.ts`
- `lib/marketing/creative-derivatives.ts`
- `types/creative-derivative-database.ts`
- `lib/marketing/living-artwork-workspace.ts`
- `app/studio/living-artwork-actions.ts`
- `components/studio/living-artwork-loop-kit-prep.tsx`
- `components/studio/living-artwork-workflow.tsx`
- `components/studio/release-workspace-v2.tsx`
- `lib/studio/intent/domain.ts`
- `lib/studio/intent/server.ts`
- `lib/studio/artist-operating-snapshot.ts`
- `app/studio/(protected)/page.tsx`
- `tests/ensemblis-intent-resolution.test.mjs`
- `e2e/ensemblis-ux-v5.spec.mjs`
- V5 route inventory / roadmap

---

# Exit criteria

This implementation is not finished merely when a Story image can be rendered.

It is finished when:

- visual creation no longer incorrectly requires a Moment;
- the cover-to-static job is obvious from Create and Release;
- static output is useful with visual AI disabled;
- copy is exact and editable;
- Story / portrait / square are true recompositions;
- approval has durable spec + media provenance;
- Living Artwork uses the approved static composition exactly;
- Today and Launcher understand the unified visual family;
- existing publication/campaign paths can consume the approved image;
- legacy Living Artwork remains compatible;
- mobile and desktop acceptance pass;
- the full repository CI matrix is green.
