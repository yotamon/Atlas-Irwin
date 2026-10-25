# Release Visual — Cover-to-Social Artwork Workflow

**Status:** Proposed product/design contract for issue #289  
**Date:** 2026-10-06  
**Owner:** Create / Visual  
**Related:** Living Artwork (#285 / PR #286), UX V5, Creative Derivatives, Visual Brand DNA

## 1. Problem

The current Create → Visual path jumps directly from release artwork into Living Artwork / motion.

That is one step too late for a common artist job:

```
release cover
  → Instagram-ready static visual
  → optional promotional copy
  → optional animation
  → export / publish
```

An artist should be able to take the approved cover and make a polished Story / feed version such as:

- clean;
- OUT NOW;
- OUT FRIDAY;
- PRE-SAVE;
- LISTEN NOW;
- custom copy;

without entering video generation and without spending generative credits.

The product must not solve this by adding another isolated "Promo" tool. The correct integration is to evolve the existing Visual family so static release artwork becomes the normal first step and Living Artwork becomes the optional motion continuation.

## 2. Product decision

Keep the existing Create outcome ID `visual` for compatibility, but change its mental model from:

> Create a memorable visual loop

to:

> Create release visuals

The visual family becomes release-first.

### Canonical journey

```
Create → Visual
  → Source
  → Message
  → Design
  → Review
  → Use
       ├─ Export static
       ├─ Create another format
       └─ Animate this artwork
             → Living Artwork
             → Review loop
             → Full-track / social video
```

Living Artwork remains the existing motion subsystem. It does not get duplicated or replaced.

## 3. UX V5 ownership

### Primary owner

- Product family: Create → Visual
- New contextual route: `/studio/create/visual/[id]`
- Existing downstream route: `/studio/create/loop/[id]`
- No new primary navigation entry

### Visibility

`/studio/create/visual/[id]` is **Contextual / Context only**.

Natural discovery:

- Create → Visual;
- Release → Create visual;
- Action Launcher intents;
- Today / Continue;
- an approved visual asset → Animate.

### V5 contract

The default visual workflow must answer:

1. What release am I designing for?
2. What is the current visual source?
3. What message is being communicated?
4. What format is being designed?
5. What is the recommended layout?
6. What is the single next action?
7. Why is that recommendation appropriate?

Technical renderer/provider details stay behind disclosure.

## 4. Release-first, not Moment-first

Static promo artwork does not need musical timing.

Today, `startOutcomeCreative` requires an approved Moment for every outcome. That requirement is valid for Reach / Streams / Lyric, but wrong for release artwork.

### Source modes

Extend the Create outcome contract with an explicit source mode:

```ts
type CreateSourceMode = "moment" | "release";

type CreateOutcome = {
  ...
  sourceMode: CreateSourceMode;
}
```

Recommended outcome ownership:

- reach → moment
- streams → moment
- lyric → moment
- visual → release

`recommendCreativeDirections()` should rank only moment-owned outcomes. Release-owned visual work should be projected separately from the active/requested Release.

### Visual start contract

A visual content item may start with:

- `release_id`: required;
- `moment_id`: optional;
- `audio_timestamp_*`: optional.

Audio / Moment context is resolved only when a later action requires it:

- animate with music;
- short-form video with audio;
- full-track visualizer.

This removes an artificial blocker from static design.

## 5. User-facing stages

## 5.1 Source

Default source hierarchy:

1. explicit approved visual selected by the user;
2. approved Release Visual asset for the same content item;
3. canonical release artwork / cover;
4. approved artist-tagged image chosen from Library.

Do not silently choose generic Visual Brand references as the main source. Visual Brand DNA guides treatment; it does not replace release identity.

Artist-facing actions:

- Use release cover;
- Choose another approved visual;
- Open Library.

## 5.2 Message

Message presets:

- `clean`
- `out_now`
- `out_friday`
- `pre_save`
- `listen_now`
- `custom`

Canonical type:

```ts
type ReleaseVisualMessageIntent =
  | "clean"
  | "out_now"
  | "out_friday"
  | "pre_save"
  | "listen_now"
  | "custom";
```

### Smart default

Use `releaseLifecycle()` plus the actual release date.

- development → Clean
- upcoming:
  - if the release date is the immediately relevant Friday, prefer Out Friday;
  - otherwise use a date-aware upcoming treatment only when the date is known;
- launch window → Out Now
- catalog → Listen Now or Clean
- archived → do not suggest active promotional copy by default

No generated claim may invent a date or imply availability that does not match canonical release state.

### Copy model

```ts
type ReleaseVisualCopy = {
  eyebrow: string | null;
  headline: string | null;
  title: string | null;
  artistName: string | null;
  dateLabel: string | null;
  supportingLine: string | null;
  cta: string | null;
};
```

Required promotional text is deterministic finishing. Do not send `OUT NOW`, dates, CTA text, or exact title typography to an image model and hope it renders correctly.

## 5.3 Design

Initial target packages:

- Instagram Story image — 1080 × 1920 — 9:16
- Instagram Feed Portrait — 1080 × 1350 — 4:5
- Instagram Square — 1080 × 1080 — 1:1

The canonical `socialPlatformPackages()` registry remains authoritative for dimensions and safe areas.

Add image packages rather than hard-code dimensions in the workflow:

- `instagram-story-image`
- existing `instagram-feed-portrait`
- `instagram-square`

Story may legitimately exist as both image and video; package lookup already includes `outputKind`.

### Layout presets

V1 supports a small authored system:

1. **Cover focus**
   - complete cover stays intact;
   - background extends/softens the cover;
   - message lives in protected negative space.

2. **Editorial split**
   - cover and message occupy distinct editorial zones;
   - stronger typography hierarchy;
   - useful for OUT NOW / date-led messaging.

3. **Full-bleed adaptation**
   - source image extends to canvas;
   - safe text is placed over controlled contrast treatment;
   - only when the source supports it.

4. **Minimal frame**
   - restrained border/frame treatment;
   - maximum preservation of original artwork;
   - best default for strong cover art.

Do not expose raw CSS, coordinates, font sizes, or renderer jargon.

### Visual Brand DNA influence

Visual Brand DNA may influence ranking and styling through:

- palette;
- minimal ↔ maximal spectrum;
- dark ↔ bright;
- typography style guidance;
- negative-space preference;
- focal strategy;
- framing preference;
- continuity rules;
- anti-style.

It must not:

- replace the cover;
- introduce a new visual motif merely because it exists in brand memory;
- force a logo or typeface not present/approved;
- redraw artwork typography.

The release artwork remains the dominant identity source.

## 5.4 Review

The user reviews 2–4 deterministic composition variants.

These are layout variants, not AI image generations.

Each variant must show:

- exact target format;
- exact promotional copy;
- safe-area-aware composition;
- real source image;
- final typography.

Allow:

- select;
- edit copy;
- switch format;
- change layout;
- approve.

Do not persist every transient layout exploration as a durable content item.

Persist only the selected canonical composition spec and its rendered assets.

## 5.5 Use

Once approved:

Primary actions:

- Open / save image;
- Create another format;
- Animate this artwork.

Secondary contextual actions may include:

- use in a campaign;
- schedule/publish through existing social flow;
- open Media Library lineage.

Animation remains optional.

## 6. Canonical composition contract

The approved design should be a composition specification, not just one PNG.

Proposed domain:

```ts
type ReleaseVisualFormatId =
  | "instagram-story-image"
  | "instagram-feed-portrait"
  | "instagram-square";

type ReleaseVisualLayoutId =
  | "cover_focus"
  | "editorial_split"
  | "full_bleed"
  | "minimal_frame";

type ReleaseVisualSpec = {
  version: 1;
  artistId: string;
  releaseId: string;
  contentItemId: string;
  sourceAssetId: string | null;
  sourceUrl: string;
  messageIntent: ReleaseVisualMessageIntent;
  copy: ReleaseVisualCopy;
  layout: ReleaseVisualLayoutId;
  primaryPackageId: ReleaseVisualFormatId;
  visualBrandVersionId: string | null;
  visualBrandFingerprint: string | null;
  backgroundTreatment: "extended_blur" | "solid" | "full_bleed";
  textTreatment: {
    family: "display" | "supporting";
    weight: "regular" | "medium" | "bold";
    case: "original" | "uppercase";
    align: "left" | "center";
  };
};
```

The spec must be JSON-serializable and versioned.

## 7. Rendering architecture

## 7.1 Default renderer

V1 should use a deterministic zero-generative-spend renderer.

Recommended implementation:

- one shared pure layout engine computes geometry from `ReleaseVisualSpec + SocialPlatformPackage`;
- browser Canvas renders both live preview and final PNG;
- app-owned web fonts are awaited before final rasterization;
- source media is fetched from approved public/storage URLs;
- final PNG is uploaded via a server action;
- server validates artist/content/source/format and stores the output as `media_assets`;
- exact `ReleaseVisualSpec` is saved in generation/media metadata.

Why browser Canvas for V1:

- zero AI spend;
- no paid worker required;
- preview is the actual renderer;
- supports fast copy/layout iteration;
- avoids a second image-processing infrastructure;
- already matches the browser-side portrait preparation pattern introduced by Living Artwork.

The render contract must be isolated so a future server renderer can reproduce the same spec.

## 7.2 Renderer invariants

- Never stretch the cover.
- Do not crop the cover in `cover_focus` or `minimal_frame`.
- Do not place essential text outside the package safe area.
- Maintain sufficient contrast behind text.
- Preserve exact user copy.
- No fake buttons / fake platform UI.
- No watermarks.
- No generative spend.
- Raster export should be PNG for V1.

## 7.3 Optional generative enhancement

Not required for V1.

If added later:

- it may extend/transform the background only;
- required typography remains deterministic;
- quote/spend approval remains mandatory;
- the deterministic source composition remains recoverable;
- AI policy must allow visuals;
- the user can always use the zero-spend path.

## 8. Persistence and lineage

Do not add a new workflow-state table.

Reuse:

- `content_items`
- `generation_runs`
- `media_assets`
- `media_links`
- `creative_derivatives`
- `marketing_events`

### Content item

The content item represents one visual creative family for one release.

Recommended marker:

```
[release-visual:v1]
```

Do not parse business-critical state solely from human prose. Store durable structured state in generation/media metadata and derive UI stage from canonical records.

### Generation run

When a design is approved, write a zero-cost deterministic generation lineage entry:

- provider: `ensemblis-compositor`
- model: `release-visual-v1`
- purpose: `content_asset:<contentItemId>`
- estimated_cost_usd: 0
- actual_cost_usd: 0
- input_context: selected spec + source lineage + platform package
- output: selected spec + primary rendered asset IDs + stage
- quality_gate_passed: true only after render validation

This follows existing precedent where deterministic creative derivatives already use `generation_runs`.

### Media roles

Recommended roles:

- `release_visual_source`
- `release_visual_story`
- `release_visual_feed_portrait`
- `release_visual_square`
- `release_visual_primary`
- `living_artwork_source`

Do not create duplicate asset bytes merely because one asset has multiple semantic uses. Link the same media asset with another role when appropriate.

### Primary asset

`content_items.asset_url` points to the currently selected primary Release Visual raster for compatibility with existing Production / publication flows.

Original release artwork is never overwritten.

## 9. Creative derivatives integration

The existing image derivative path currently reuses an approved image unchanged.

That is insufficient across 9:16, 4:5 and 1:1.

Extend:

```ts
type CreativeDerivativeStrategy =
  | "reuse_approved_image"
  | "deterministic_image_recompose"
  | "deterministic_video_repackage";
```

Add an append-only migration extending the strategy check constraint.

For a Release Visual master:

- source = approved composition spec;
- derivative strategy = `deterministic_image_recompose`;
- target package drives a new deterministic raster render;
- no new creative direction;
- no AI generation;
- zero generation cost.

This turns Creative Derivatives into the correct place for "same approved design, another social format".

## 10. Living Artwork handoff

This is the most important integration boundary.

### User action

**Animate this artwork**

### Contract

1. Require an approved Release Visual spec.
2. Resolve or render a 9:16 Story asset from the approved spec.
3. Add a `living_artwork_source` media link to that exact asset.
4. Redirect to `/studio/create/loop/[contentItemId]`.
5. Living Artwork source resolution must prefer:
   - explicit `living_artwork_source`;
   - approved Release Visual primary/story;
   - existing Living Artwork prepared source frame;
   - release cover.
6. If the explicit source is already valid 1080×1920:
   - do not add blur;
   - do not reframe;
   - do not alter typography;
   - use the exact raster as first and last frame.
7. If the selected approved Release Visual is not 9:16:
   - deterministically render its same spec to Story first;
   - never crop the approved raster to fake 9:16.

### Content item reuse

Use the same `content_item_id`.

Do not create a second content item only because the artist chooses motion.

That preserves:

- release lineage;
- campaign lineage;
- selected copy;
- visual identity;
- Today resume;
- publication/learning linkage.

The static and motion outputs remain separate media assets under the same creative family.

## 11. Create integration

## 11.1 Outcome contract

Keep `id: "visual"`.

Proposed artist-facing copy:

- label: `Build recognition`
- shortLabel: `Create release visuals`
- description: `Turn the release artwork into a polished social visual, then animate it if motion adds value.`
- platform: `Instagram`
- format: `Release visual`
- goal: `Recognition`
- mediaKind: `image`
- workflow: `release_visual`
- sourceMode: `release`

## 11.2 Create page behavior

Moment-owned outcomes keep the existing Moment cards.

Release Visual becomes a release-owned card:

- preview the actual cover;
- show release title/date/lifecycle;
- CTA: **Create visual**;
- do not show a fake "Ensemblis picked this musical section" block.

If `outcome=visual` is requested, the release-owned visual card is prioritized.

If no release artwork exists, the card becomes an actionable blocker linking to Release artwork setup.

## 11.3 Start action

Refactor `startOutcomeCreative` into source-aware branches.

For `sourceMode: "moment"`:
- preserve current Moment requirement.

For `sourceMode: "release"`:
- require artist-scoped Release;
- require artwork or allow the workflow to land in Source blocker state;
- create one visual content item;
- redirect to `/studio/create/visual/[id]`.

Do not require `moment_id`.

## 12. Release object integration

Release is a natural entry point because this workflow starts from release identity.

Add **Create visual** to the Release content/promotion surface.

It should deep-link to:

```
/studio/create?release=<releaseId>&outcome=visual
```

Do not create a special release-only implementation.

## 13. Action Launcher integration

The current classifier collapses promo artwork and animation into `desiredOutcome: "visual"`.

We need one additional bounded hint so the same visual family can choose its correct starting mode.

Proposed:

```ts
type CreateVisualMode = "static" | "motion" | null;

type ClassifiedStudioIntent = {
  ...
  desiredOutcome: string | null;
  createMode: CreateVisualMode;
}
```

Update deterministic and semantic schemas.

### Static examples

- "make an Out Now Story for X"
- "make X cover fit Instagram"
- "create an Instagram post for X"
- "make a release visual for X"
- "Out Friday artwork for X"

→ `desiredOutcome: "visual", createMode: "static"`

### Motion examples

- "animate this artwork"
- "loop this cover"
- "make a visualizer"
- "make a looping visual"

→ `desiredOutcome: "visual", createMode: "motion"`

### URL behavior

Release result:

```
/studio/create?release=<id>&outcome=visual&mode=static
```

Motion intent may:

- enter the Release Visual family with `mode=motion`, which automatically resolves/creates a visual content item and then enters Living Artwork; or
- when an approved visual family already exists, deep-link directly to its loop route.

Do not encode provider/model names in Launcher output.

## 14. Today / Continue

The current snapshot already projects Living Artwork.

Replace the narrow projection with a visual-family projection.

Priority:

1. unfinished Release Visual design;
2. approved static visual with an unfinished explicit animation continuation;
3. active Living Artwork;
4. other release continuation.

Artist-facing examples:

- `Release visual · Choose the Out Now layout`
- `Release visual · Review Story artwork`
- `Living Artwork · Loop check in progress`

Do not create duplicate Continue cards for one content item.

## 15. Promotion / campaign integration

This capability should strengthen existing promotion surfaces, not create a new Promotion database.

A campaign content item may point to the approved Release Visual asset.

Future campaign planning can request a visual family through the same Create contract.

V1 does not auto-publish or auto-schedule.

Existing publication approval remains authoritative.

## 16. AI policy and cost

### Zero-spend default

All V1 static design:

- source adaptation;
- typography;
- background extension/blur;
- layout variants;
- format derivatives;

is deterministic and costs zero generative credits.

### AI visuals disabled

Release Visual still works fully.

### AI visuals enabled

No behavior changes unless the user explicitly chooses a future optional enhancement.

### Spend boundary

Optional generative enhancement must use existing quote / approval / `generation_runs` spend policy.

## 17. Quality gates

A static render is ready only if:

- output dimensions match target package;
- MIME is expected;
- non-empty file;
- source lineage exists;
- render spec exists and parses;
- all required copy matches the approved spec;
- safe-area geometry passes deterministic checks;
- text boxes do not overflow;
- no NaN/invalid geometry;
- source image was not distorted.

These checks should run before approval is marked complete.

No model-based visual quality gate is needed for deterministic V1 layouts.

## 18. Failure and recovery

### Source fetch / CORS failure

- keep content item;
- show source-specific recovery;
- allow selecting a Library copy;
- do not lose message/design selections.

### Font loading failure

- fail final export closed;
- preview may use fallback only while clearly not Ready;
- do not persist a mismatched raster.

### Upload failure

- selected spec remains recoverable;
- retry same deterministic render;
- idempotency uses spec fingerprint + package.

### Duplicate click

- same spec/package should reuse the existing asset/run when hash matches.

### Format derivative failure

- master remains approved;
- only failed target derivative is retryable.

### Living Artwork handoff failure

- approved static visual remains intact;
- retry link/redirect without regenerating the static asset.

## 19. Telemetry

Only normalized metadata.

Suggested events:

- `release_visual_started`
- `release_visual_message_selected`
- `release_visual_layout_selected`
- `release_visual_rendered`
- `release_visual_approved`
- `release_visual_derivative_rendered`
- `release_visual_animation_started`

Payloads may include:

- content item ID;
- release ID;
- message intent enum;
- layout enum;
- package ID;
- source role;
- zero-spend boolean;
- visual brand version ID;
- animation handoff boolean.

Do not log arbitrary custom promotional copy into telemetry.

## 20. Route inventory

Add:

```
/studio/create/visual/[id]
  owner: Create
  role: Release Visual staged workflow
  visibility: Contextual
  discovery: Create visual / Release / intent / Continue
  launcher: Context only
```

Keep:

```
/studio/create/loop/[id]
  owner: Create
  role: Living Artwork motion continuation
  visibility: Contextual
  discovery: approved visual → Animate / explicit motion intent
  launcher: Context only
```

## 21. Compatibility / migration behavior

Existing Living Artwork content items remain valid.

Do not rewrite old `[living-artwork:v1 ...]` records.

New visual items use `[release-visual:v1]`.

Explicit old animation intents may continue to create/enter Living Artwork directly where needed for compatibility, but normal cover-based visual creation should route through Release Visual.

No destructive migration of existing media roles.

## 22. Cross-artist acceptance

### Atlas Irwin

Expected:

- strong cover-driven 9:16 visual;
- OUT NOW / date treatment;
- optional motion;
- Visual Brand DNA can influence restrained typography/composition;
- generative enhancement may be available by policy.

### Cerebero Spinal / non-AI visual policy

Expected:

- full static workflow works;
- no AI provider required;
- cover remains the identity anchor;
- deterministic Story/feed/square output;
- Animate may use imported/source motion paths allowed by policy, but no generative visual must be implied.

This feature fails cross-artist acceptance if it requires generative visual AI to be useful.

## 23. Non-goals for V1

- no Photoshop-style freeform editor;
- no arbitrary drag-anything canvas;
- no template marketplace;
- no AI-written promotional claims;
- no auto-publish;
- no automatic generative background replacement;
- no second media library;
- no second campaign system;
- no separate Promo primary navigation item;
- no 16:9 YouTube visualizer design surface yet.

## 24. Success definition

The feature is complete when an artist can:

1. open a Release;
2. choose Create visual;
3. see the actual cover as source;
4. choose Clean / Out Now / Out Friday / Pre-save / Listen Now / Custom;
5. approve a polished Instagram Story image with no AI spend;
6. render the same approved composition to 4:5 and 1:1 without cropping/reusing the wrong raster;
7. choose Animate this artwork;
8. enter Living Artwork with the exact approved 9:16 design preserved;
9. leave and resume the same creative family from Today;
10. complete all of the above without understanding provider, route, table, or worker names.
