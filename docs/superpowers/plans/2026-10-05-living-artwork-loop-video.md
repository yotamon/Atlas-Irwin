# Living Artwork / Loop Video Implementation Plan

> **For agentic workers:** implement task-by-task and keep this checklist updated. Prefer focused tests at each boundary before running the full CI matrix.

**Goal:** Extend Ensemblis Create so an artist can turn approved artwork into one reusable seamless motion loop, validate/repair it, and render full-track + short-form video outputs without repeatedly paying for generative video.

**Tracking:** #285  
**Spec:** `docs/superpowers/specs/2026-10-05-living-artwork-loop-video-design.md`

**Architecture:** Reuse the existing Create `visual` outcome, `generation_runs`, media lineage, creative provider router, Higgsfield start/end image support, Media Worker runtime and social finisher. Add one contextual Create workflow, one loop normalization/QC worker job, one full-track loop renderer, and the minimum routing/persistence glue required to connect those existing boundaries.

**Tech stack:** Next.js 16, React 19, TypeScript, Supabase/Postgres, Python media worker, FFmpeg, existing Studio design system, Node contract tests, Python tests, Playwright.

## Global constraints

- Do not introduce another top-level Create/Video subsystem.
- Do not add a primary nav item.
- Keep `user identity != workspace != artist`; every record/job keeps explicit artist lineage.
- Reuse `media_assets` / `media_links`; do not create a parallel asset store.
- Native generation must remain behind visual-AI policy + quote/spend approval.
- The zero-spend Loop Kit path is a first-class supported workflow.
- External consumer tools are a handoff, not browser automation.
- Provider/model details stay behind Details/Advanced.
- No AI generation is needed to change output duration.
- Full-track visual rendering must not re-master, compress, normalize or EQ canonical audio.
- Preserve TypeScript producer → durable job → Python worker → callback discriminator/version parity.
- Generated/repaired assets never silently replace approved public media roles.
- Default UI shows one primary next action per stage.

---

## Task 1 — Establish the Living Artwork domain contract

**Files:**
- Create: `lib/marketing/living-artwork.ts`
- Modify: `lib/studio/create-outcomes.ts`
- Create: `tests/living-artwork-contract.test.mjs`
- Modify: `docs/ensemblis-ux-v5-route-inventory.md`

**Interfaces:**
- Consumes existing `visual` Create outcome.
- Produces a derived workflow stage and small loop-specific domain vocabulary.
- Does not persist a second workflow-state machine.

- [ ] **Step 1: Write failing contract tests**

Assert that:

- `visual` remains the canonical outcome for looping artwork;
- the outcome explicitly resolves to the Living Artwork workflow rather than generic production;
- visible workflow stages are exactly:
  - `source`
  - `motion`
  - `make_loop`
  - `review`
  - `export`
- visible stage is derived from canonical records rather than stored independently;
- an already approved normalized loop resolves directly to `export`;
- an in-progress normalization/generation resolves to `make_loop`;
- a raw loop without approval resolves to `review`.

Suggested public contract:

```ts
export type LivingArtworkStage =
  | "source"
  | "motion"
  | "make_loop"
  | "review"
  | "export";
```

- [ ] **Step 2: Run focused test and verify failure**

```bash
node --test tests/living-artwork-contract.test.mjs
```

- [ ] **Step 3: Add the minimal domain module**

Keep it policy/derivation only. No Supabase calls in pure helpers.

Include:

- workflow identifier;
- stage derivation;
- supported artist-facing motion presets;
- canonical 9:16 loop target;
- recommended loop duration range;
- status vocabulary mapping.

- [ ] **Step 4: Mark the existing visual outcome as Living Artwork**

Prefer an explicit field over checking `outcome.id === "visual"` throughout the codebase.

Example direction:

```ts
workflow: "living_artwork"
```

Standard Reel outcomes continue through existing content production.

- [ ] **Step 5: Update V5 route inventory**

Add:

`/studio/create/loop/[id]`

Owner: Create  
Visibility: Contextual  
Discovery: Create visual outcome / Track / Release / launcher  
Launcher: Context only

- [ ] **Step 6: Run focused tests**

Expected: PASS.

---

## Task 2 — Create the staged Living Artwork workflow shell

**Files:**
- Create: `app/studio/(protected)/create/loop/[id]/page.tsx`
- Create: `lib/marketing/living-artwork-workspace.ts`
- Create: `components/studio/living-artwork-workflow.tsx`
- Modify: `app/studio/create-actions.ts`
- Modify: `app/studio/(protected)/create/page.tsx`
- Modify: `app/studio/design-system/workflows.css`
- Test: `tests/living-artwork-contract.test.mjs`
- Test: `tests/ensemblis-ux-v5-contract.test.mjs`

**Interfaces:**
- Route stays thin.
- `living-artwork-workspace.ts` owns the artist-scoped read model.
- The component renders one active stage at a time.

- [ ] **Step 1: Add failing UX/source-contract assertions**

Assert:

- Create still asks “What do you want to make?”;
- choosing the `visual` outcome enters the contextual loop workflow;
- the workflow keeps source artwork + track/release identity visible;
- only one stage body is expanded;
- provider/model names are absent from the default view;
- one primary action is visible for the current stage.

- [ ] **Step 2: Refactor content creation only as much as required**

If `saveContentV2` currently owns redirect behavior, extract the smallest reusable command that can create the content item and return its ID.

Do not call a server action from another server action as an application API.

`startOutcomeCreative` should:

1. validate artist + approved Moment;
2. create the content intent using existing content semantics;
3. route standard outcomes as today;
4. redirect Living Artwork to `/studio/create/loop/[contentId]`.

- [ ] **Step 3: Add the workspace read model**

Load only the data needed by the loop workflow:

- artist;
- content item;
- release/track;
- selected Moment;
- approved/source visual candidates;
- existing loop generation run;
- raw/normalized/approved loop assets;
- active media jobs;
- available export assets;
- visual AI policy;
- native loop-provider readiness.

Fail closed on ownership. Degrade optional provider readiness safely.

- [ ] **Step 4: Implement workflow shell**

Use canonical Studio primitives and `WorkflowStepper`.

Stages:

1. Source
2. Motion
3. Make loop
4. Review loop
5. Export

Mobile must keep current preview + primary action reachable without desktop-only hover.

- [ ] **Step 5: Run focused tests**

```bash
node --test tests/living-artwork-contract.test.mjs tests/ensemblis-ux-v5-contract.test.mjs
```

---

## Task 3 — Implement source selection and the zero-spend Loop Kit

**Files:**
- Create: `lib/marketing/loop-kit.ts`
- Create: `app/studio/living-artwork-actions.ts`
- Modify: `components/studio/living-artwork-workflow.tsx`
- Modify: existing deterministic image/media preparation utility where appropriate
- Test: `tests/living-artwork-contract.test.mjs`
- Test: add focused action/lineage test near existing marketing creative tests

**Interfaces:**
- Produces one canonical source frame.
- Produces a versioned Loop Kit manifest.
- Does not submit anything to an external consumer website.

- [ ] **Step 1: Write Loop Kit contract tests**

Assert the manifest contains:

- version;
- artist/content/release source lineage;
- source asset ID;
- one 9:16 frame URL;
- recommended duration;
- loop-aware prompt;
- first-frame instruction = source;
- last-frame instruction = same source.

Assert first/last are not two independently generated frames.

- [ ] **Step 2: Resolve visual source hierarchy**

Use:

1. explicitly selected asset;
2. release artwork;
3. approved visual reference;
4. approved creative asset.

Never infer another artist’s asset from owner ID alone.

- [ ] **Step 3: Prepare canonical 9:16 source frame**

Prefer deterministic transformation of an approved source over buying an image generation.

For square cover art, use a visually safe deterministic portrait treatment (for example framed art over an extended/blurred background) rather than destructive crop.

Store the derived frame as a normal media asset with source lineage.

- [ ] **Step 4: Generate loop-aware prompt**

Prompt inputs:

- artist visual rules / bounded memory;
- release/title context;
- motion preset;
- source preservation;
- seamless closure requirements.

Do not persist raw prompt text into telemetry.

- [ ] **Step 5: Build Loop Kit UI**

Primary action when the artist wants no AI spend:

**Prepare Loop Kit**

Then show:

- preview/download frame;
- copy prompt;
- short instruction: use this same image as first and last frame;
- upload/import control for the resulting MP4.

Do not hard-code volatile “free credits” claims into product UI.

- [ ] **Step 6: Validate imported file at the request boundary**

Before durable worker dispatch:

- expected media type;
- safe storage URL;
- artist/content scope;
- bounded file size.

Full codec/duration/QC remains worker-owned.

---

## Task 4 — Add loop-aware native generation routing

**Files:**
- Modify: `lib/marketing/creative-router.ts`
- Modify: `lib/marketing/creative-provider-catalog.ts`
- Modify: `lib/marketing/creative-provider-types.ts` only if required
- Modify: `app/studio/marketing-creative-actions.ts` or extract a small reusable generation command
- Modify: `app/studio/living-artwork-actions.ts`
- Test: existing creative router/provider tests
- Test: `tests/living-artwork-contract.test.mjs`

**Interfaces:**
- Marketing-level loop intent maps to existing provider `shot_video`.
- Provider request uses `start_image` + `end_image`.
- Same URL must be supplied for both.

- [ ] **Step 1: Add failing router tests**

Add:

```ts
intent: "seamless_loop"
```

Assert:

- non-loop-capable models are excluded;
- a model with no verified start+end support cannot be selected even if cheaper;
- generated audio is disabled;
- 9:16 is preserved;
- duration stays in the short-loop range;
- source media contains identical `start_image` and `end_image`.

- [ ] **Step 2: Add explicit loop capability routing**

Do not infer support from marketing copy.

For Higgsfield, authoritative capability is already:

- `supportsStartImage`
- `supportsEndImage`

For any future provider, add an equally explicit verified capability before routing loop work there.

- [ ] **Step 3: Reuse existing generation ledger and spend gate**

Living Artwork native generation must create/advance normal `generation_runs`.

Preserve:

- quote;
- reserve;
- user approval;
- provider request ID;
- estimated/actual cost;
- retry/reconciliation rules.

Do not create “free” provider records for external handoff.

- [ ] **Step 4: Native UI stays outcome-first**

Artist sees:

- motion direction;
- quality;
- estimated cost;
- primary action: Approve generation.

Provider/model details go under Details.

- [ ] **Step 5: Run creative routing tests**

Include regression tests for standard non-loop creative routing.

---

## Task 5 — Normalize loops and implement seam QA / deterministic repair

**Files:**
- Modify: `contracts/media-worker.v1.json`
- Modify: `lib/media-worker/contract.ts`
- Modify: `services/media-worker/app/runner.py`
- Create: `services/media-worker/app/loop_video.py`
- Modify: TS dispatcher/job authorization owner as required
- Create: Python loop worker tests
- Modify: cross-language Media Worker parity tests
- Modify: `app/studio/living-artwork-actions.ts`

**New Media Worker job:** `normalize_loop_video`

**Interfaces:**
- Input: source clip + approved output location + repair policy.
- Output: normalized loop asset + deterministic QC metadata.

- [ ] **Step 1: Add failing cross-runtime discriminator tests**

Add `normalize_loop_video` to:

- JSON contract;
- TypeScript union/mapping;
- Python runner discriminator set;
- processor ID map.

Verify parity fails before implementation.

- [ ] **Step 2: Define bounded payload validation**

Required:

- source URL;
- output upload/public URL;
- expected artist/content lineage in the TS-owned job record;
- `repair_policy: "none" | "auto"`.

Worker validation:

- remote URL policy;
- size;
- valid video stream;
- duration within a short-loop ceiling;
- dimensions/frame rate sane.

- [ ] **Step 3: Normalize the loop mezzanine**

Output target:

- MP4 / H.264;
- portrait 1080×1920 where source quality supports it;
- 30 fps;
- no audio;
- faststart;
- stable pixel aspect ratio.

Never stretch a source destructively merely to satisfy dimensions; use the existing crop/focus policy or safe framing.

- [ ] **Step 4: Implement seam measurements**

Sample deterministic frames/windows around start and end.

Return metrics such as:

- first/final similarity;
- boundary-window similarity;
- luminance/color delta;
- source duration/frame count;
- invalid/freeze findings.

Do not choose final thresholds until fixture calibration.

- [ ] **Step 5: Build fixture calibration**

Create fixtures:

- exact loop;
- visually clean generated-style loop;
- small seam near miss;
- severe jump cut;
- corrupt/empty video.

Use these to choose Ready / Repair available / Needs review / Blocked thresholds.

- [ ] **Step 6: Implement auto repair**

For a repairable near miss:

- wrap source against itself;
- crossfade only around the boundary;
- keep a bounded repair duration;
- render repaired loop;
- rerun seam QA;
- return before/after metrics.

Retain original raw source as its own asset.

- [ ] **Step 7: Reconcile worker callback**

On completion:

- store normalized/repaired asset through canonical media lineage;
- attach QC metadata;
- avoid duplicate asset role assignment on callback replay;
- move visible stage to Review.

- [ ] **Step 8: Run Python + contract tests**

Run the focused worker and cross-language parity suites.

---

## Task 6 — Build artist-facing loop review and approval

**Files:**
- Modify: `components/studio/living-artwork-workflow.tsx`
- Create if useful: `components/studio/loop-review-player.tsx`
- Modify: `app/studio/living-artwork-actions.ts`
- Modify: media approval/link policy module that owns canonical public roles
- Test: `tests/living-artwork-contract.test.mjs`
- Add Playwright coverage later in Task 9

**Interfaces:**
- Consumes normalized loop + QC result.
- Produces explicit approval without replacing unrelated public roles.

- [ ] **Step 1: Write review-state tests**

Assert:

- clean loop → primary action Approve;
- repairable loop → primary action Repair;
- uncertain loop → primary action Review/Approve with warning;
- blocked loop → Replace;
- approved loop → Export;
- Generate another is always secondary once a usable loop exists.

- [ ] **Step 2: Build boundary preview**

Preview should visibly replay the seam multiple times so the artist can judge the exact end → start transition.

Do not show raw SSIM/codec data by default.

- [ ] **Step 3: Approval action**

Approval records the normalized loop as the chosen loop source for the content item/release context.

It must:

- be artist-scoped;
- retain source/generation/repair lineage;
- be idempotent;
- not replace unrelated approved artwork/public roles.

- [ ] **Step 4: Repair action**

Queues `normalize_loop_video` with `repair_policy: "auto"` against the original raw loop.

If repair fails quality thresholds, keep the artist in Review with one actionable explanation.

---

## Task 7 — Add full-track loop visualizer rendering

**Files:**
- Modify: `contracts/media-worker.v1.json`
- Modify: `lib/media-worker/contract.ts`
- Modify: `services/media-worker/app/runner.py`
- Refactor: shared loop/render helpers from `services/media-worker/app/social_finishing.py`
- Create: `services/media-worker/app/loop_visualizer.py`
- Create/modify: TS render dispatcher/reconciliation module under `lib/marketing/` or `lib/media-worker/`
- Test: Python render tests
- Test: cross-language parity
- Test: Living Artwork export tests

**New Media Worker job:** `render_loop_visualizer`

- [ ] **Step 1: Add failing contract parity tests**

Add the new discriminator + processor ID.

- [ ] **Step 2: Extract reusable video-loop primitive**

The current social finisher already uses:

```text
-stream_loop -1
```

Move reusable looping/scaling primitives into a shared worker helper so social finishing and full-track rendering do not drift.

Do not change social output behavior unintentionally.

- [ ] **Step 3: Define full-track payload**

Required:

- approved normalized loop URL;
- canonical audio URL;
- upload/public URL;
- target dimensions/fps;
- `duration_mode: "full_audio"`.

V1 default:

- 1080×1920;
- 30 fps.

- [ ] **Step 4: Derive duration from audio**

Use ffprobe on the canonical audio.

Safety:

- reject missing/invalid audio;
- bound maximum duration to a music-safe ceiling (initially 20 minutes unless fixtures/product evidence require another value);
- trim video to exact audio duration.

- [ ] **Step 5: Mux without music processing**

For full-track visualizer:

- no limiter;
- no loudness normalization;
- no EQ/compression;
- no mastering step;
- only delivery codec conversion required by MP4.

The source master remains the audio truth.

- [ ] **Step 6: Add output QC**

Return:

- file hash;
- duration;
- dimensions/fps;
- audio/video stream presence;
- temporal review frames.

Reject obvious truncation/missing-audio outputs.

- [ ] **Step 7: Reconcile asset lineage**

Rendered output links to:

- artist;
- track/release/content item;
- approved loop asset;
- canonical audio asset/source;
- render job.

Callback replay must not duplicate the finished role.

---

## Task 8 — Reuse the approved loop for social exports

**Files:**
- Modify: `lib/video-director/social-delivery.ts` only if the reusable finisher boundary belongs there, otherwise add a marketing-owned helper
- Modify: `app/studio/living-artwork-actions.ts`
- Modify: `components/studio/living-artwork-workflow.tsx`
- Reuse: `finish_social_video`
- Test: existing social finishing tests
- Test: Living Artwork export tests

- [ ] **Step 1: Do not route through full Video Director**

Living Artwork is a single-source loop workflow. It should not manufacture a music-video project merely to reach social finishing.

Create a small marketing-owned dispatch seam if needed.

- [ ] **Step 2: Queue social finishing from the approved loop**

Inputs:

- approved normalized loop;
- selected Moment/platform package;
- canonical track audio;
- deterministic text overlay only when the content package calls for it.

- [ ] **Step 3: Avoid AI regeneration for format/duration changes**

Story/Reel/TikTok-style outputs are deterministic transforms of the approved loop.

- [ ] **Step 4: Surface export pack**

Export stage should show artist-facing cards such as:

- Full song · Vertical
- Reel
- Story

Show Ready / Working / Needs review / Blocked states, not worker/job terminology.

Future 16:9 remains explicitly deferred unless Task 7 implementation makes it trivial and well-tested.

---

## Task 9 — Complete provenance, recovery, observability and acceptance

**Files:**
- Modify: media lineage helpers/tests
- Modify: Today/Continue projection if current workflow discovery does not already pick it up
- Modify: Action Launcher intent resolver/aliases
- Modify: `docs/ensemblis-product-roadmap.md`
- Modify: `docs/ensemblis-ux-v5-route-inventory.md`
- Modify: `docs/superpowers/specs/2026-10-05-living-artwork-loop-video-design.md` only for evidence-driven corrections
- Create/modify: `e2e/ensemblis-ux-v5.spec.mjs` or a focused Living Artwork E2E spec
- Tests: full affected Studio/worker suite

- [ ] **Step 1: Add launcher intents**

Resolve at least:

- animate artwork;
- looping visual;
- visualizer;
- loop this cover;
- reel background from this artwork.

These should resolve to Create visual/Living Artwork with object context, not a specialist route directory.

- [ ] **Step 2: Ensure Continue/resume behavior**

In-progress generation/normalization/rendering must be resumable without reconstructing source context.

If existing Today/Continue projection can consume the content item/job state, reuse it. Add a new projection only if the current contract cannot express it.

- [ ] **Step 3: Add normalized telemetry**

Events:

- `loop_workflow_started`
- `loop_kit_prepared`
- `loop_generation_prepared`
- `loop_generation_started`
- `loop_imported`
- `loop_qc_completed`
- `loop_repaired`
- `loop_approved`
- `loop_export_started`
- `loop_export_completed`

No raw private prompt text.

- [ ] **Step 4: Test failure recovery**

Cover:

- provider definite rejection before spend;
- ambiguous provider submission;
- upload failure;
- normalize/QC failure;
- repair failure;
- render failure;
- callback replay;
- page refresh while job is running;
- retry after terminal failure.

Every case must collapse to one artist-actionable state.

- [ ] **Step 5: Add authenticated browser acceptance**

Desktop + mobile:

1. enter Create with a real/fixture track context;
2. choose visual loop;
3. source visible;
4. prepare Loop Kit;
5. import fixture loop;
6. wait/resume normalization;
7. review boundary;
8. approve;
9. render full-track fixture;
10. verify export state.

Also cover native generation UI with provider call mocked at the network boundary where the existing test architecture allows it.

Fail closed if authenticated credentials are required and absent.

- [ ] **Step 6: Run focused validation**

At minimum:

```bash
node --test tests/living-artwork-contract.test.mjs
npm run typecheck
npm run lint
```

Run affected Studio contract suites, Media Worker/Python tests and E2E. Then run the repository’s normal PR CI surface.

- [ ] **Step 7: Reconcile documentation**

Update product roadmap with Living Artwork status and link #285.

Keep V5 route inventory authoritative.

Do not document third-party free-tier pricing as a durable Ensemblis guarantee.

---

## Implementation order

Recommended order:

```text
1. Domain + UX contract
2. Contextual workflow shell
3. Zero-spend Loop Kit
4. Native start/end generation
5. Normalize + QC + repair
6. Review + approval
7. Full-track renderer
8. Social export reuse
9. Recovery + E2E + docs
```

This order deliberately ships useful zero-spend behavior before the new worker/render path is complete.

## Definition of done

The feature is complete when an artist can:

1. open Create for a real track/release;
2. choose “Create a memorable visual loop”;
3. use approved artwork;
4. choose a motion direction;
5. either:
   - prepare a zero-spend Loop Kit and import the result, or
   - approve a quoted native loop generation;
6. receive automatic loop QC;
7. repair a small seam defect without AI regeneration;
8. approve the loop;
9. render a full-track 9:16 visualizer;
10. produce social derivatives from the same approved loop;
11. leave and resume the workflow safely;
12. inspect technical/provider/provenance detail only when requested.

All affected TypeScript, worker-contract, Python, lineage, UX and browser tests must pass, and no existing standard creative-generation or social-finishing flow may regress.
