# Ensemblis Living Artwork / Loop Video Design

**Status:** Proposed for implementation  
**Date:** 2026-10-05  
**Tracking:** #285  
**Product owner:** Create / Promotion  
**Primary principle:** generate one short loop once, then reuse it deterministically

## 1. Problem

Artists often need a simple promotional visual rather than a fully directed music video:

```text
artwork or artist image
        ↓
short motion loop
        ↓
full track + social variants
```

Today this usually means paying repeatedly for generative video, accepting inconsistent motion, and then manually rebuilding the result in an editor. It is especially wasteful when the desired output is intentionally repetitive: a living cover, visualizer, Story background, Reel background, or looping release visual.

Ensemblis already owns the surrounding context — the track, approved artwork, artist visual identity, best musical Moment, canonical audio, media lineage, creative policy and delivery targets. It should therefore make this workflow cheap, repeatable and artist-safe.

The production rule is:

> **Spend compute on the shortest useful motion loop. Spend deterministic processing on duration and formats.**

## 2. Goals

1. Turn approved artwork or an artist-approved image into a clean reusable video loop.
2. Make a **zero-spend path** first-class.
3. Support native AI generation only when a configured model explicitly supports the loop contract.
4. Detect whether a generated/imported loop actually closes cleanly.
5. Repair small seam defects deterministically when possible instead of buying another generation.
6. Reuse one approved loop for a full-track vertical visualizer and existing social finishing.
7. Preserve the canonical music master and media provenance.
8. Fit UX V5: intent → object → state → one next action → outcome.
9. Keep provider/model details out of the default artist-facing path.

## 3. Non-goals

V1 does **not**:

- replace Video Director for narrative or multi-shot music videos;
- build browser automation against consumer-only video websites;
- promise that any third-party free tier will remain free;
- publish directly to social platforms without existing publishing approvals;
- generate artist likeness/voice when artist policy forbids it;
- introduce a second media library or a second generation ledger;
- make a dedicated primary-navigation destination;
- create a general-purpose timeline editor.

## 4. Product placement

The feature extends the existing Create outcome:

```ts
id: "visual"
shortLabel: "Create a memorable visual loop"
```

That outcome is already the correct artist-facing mental model. We should not create a competing “visualizer subsystem”.

### Natural entry points

- Create → **Build recognition / visual loop**
- Track → Create → visual loop
- Release → Creative / Promotion → visual loop
- Action Launcher:
  - “animate this artwork”
  - “make a looping visual”
  - “make a visualizer”
  - “turn this cover into a reel background”

### Route ownership

Use one contextual staged workflow under Create, proposed as:

`/studio/create/loop/[contentId]`

It is **Contextual / Context only** in the V5 route inventory. It must never appear in primary navigation.

## 5. User journey

The workflow has five artist-facing stages.

### Stage 1 — Source

Ensemblis resolves the strongest approved visual source in this order:

1. explicitly selected image;
2. approved release artwork;
3. approved artist visual reference;
4. existing approved creative asset.

The source remains visible throughout the workflow.

Primary action: **Use this artwork**

Advanced:
- choose another approved asset;
- inspect source/history.

### Stage 2 — Motion

The user chooses an artist-facing motion direction, not a model.

Initial presets:

- **Subtle pulse** — light, reflections, texture, restrained movement;
- **Rhythmic motion** — movement with stronger musical energy;
- **Dreamlike motion** — more visible transformation while preserving composition.

Ensemblis derives the generation prompt from:

- selected source;
- artist visual memory/rules;
- release context;
- selected preset;
- loop constraints.

The prompt must contain explicit closure instructions:

- fixed or controlled composition;
- no cuts;
- no new text;
- no identity drift;
- motion must return to the original composition;
- final frame must match the source composition.

Primary action: **Make loop**

### Stage 3 — Make loop

Two first-class production routes exist.

#### A. Loop Kit — zero-spend route

Ensemblis prepares:

- a normalized 9:16 start frame;
- the same file designated as both first and last frame;
- a copyable loop-aware prompt;
- concise instructions for an external generator;
- an import target for the resulting clip.

The product may mention supported external workflows in documentation, but must not encode stale free-tier pricing or pretend browser-only consumer products are API integrations.

Primary action when no native spend is desired: **Prepare Loop Kit**

#### B. Generate in Ensemblis

Available only when:

- visual AI is allowed for the artist;
- a configured provider/model explicitly supports both start and end images;
- quote/spend approval succeeds.

The same normalized source URL is sent as both:

- `start_image`
- `end_image`

The existing spend envelope and `generation_runs` ledger remain authoritative.

Primary action when native generation is selected: **Approve generation · <quote>**

### Stage 4 — Review loop

Every imported or generated loop goes through deterministic normalization and seam QA before it can be “Ready”.

Artist-facing states:

- **Ready** — seam is clean;
- **Repair available** — small seam defect can be fixed deterministically;
- **Needs review** — technically valid but closure is uncertain;
- **Blocked** — invalid/corrupt/unsupported media.

The UI shows:

- autoplaying loop preview;
- a boundary preview that crosses the end → start seam several times;
- one plain-language quality summary;
- primary action: Approve, Repair, or Replace.

Provider diagnostics and raw metrics remain under Details.

### Stage 5 — Export

An approved loop becomes a reusable source asset.

V1 outputs:

1. **Full-track vertical visualizer** — 1080×1920, complete canonical track audio.
2. **Social clip** — reuse the existing social finishing path for Reel/Story/TikTok/Shorts-style deliverables based on the selected Moment/platform package.

Future output:
- 16:9 full-track YouTube visualizer;
- square/feed variants;
- Canvas-specific packages where provider requirements justify them.

The user should never regenerate motion merely to change duration.

## 6. Loop generation contract

Do not add a new provider-level “loop model” abstraction.

The existing provider request already has:

- `start_image`
- `end_image`
- duration;
- aspect ratio;
- resolution;
- prompt.

For native loop generation, use the existing `shot_video` operation and add a marketing-level loop intent.

Proposed input:

```ts
type CreativeRouteIntent = "standard" | "seamless_loop";

type CreativeRouteInput = {
  // existing fields...
  intent?: CreativeRouteIntent;
};
```

When `intent === "seamless_loop"`:

1. only route to a model whose adapter/catalog proves start + end image support;
2. require the same normalized source as both endpoints;
3. prefer 5–8 seconds for cost and repeatability;
4. disable generated audio;
5. preserve 9:16;
6. include closure language in the prompt.

Current Higgsfield capability metadata already provides the required `supportsStartImage` and `supportsEndImage` flags and its adapter already maps the roles to provider payloads.

Provider additions must prove the same capability before joining this route.

## 7. Zero-spend Loop Kit

The Loop Kit is a product feature, not a text-only help article.

It contains a versioned manifest:

```ts
type LoopKitManifest = {
  version: 1;
  artistId: string;
  releaseId: string | null;
  contentItemId: string;
  sourceAssetId: string;
  sourceFrameUrl: string;
  aspectRatio: "9:16";
  recommendedDurationSeconds: number;
  prompt: string;
  firstFrameInstruction: "use_source";
  lastFrameInstruction: "use_same_source";
};
```

The same asset is deliberately used for first and last frame.

The user can download/copy the kit, generate externally, then upload the resulting clip back into the same workflow.

The import must retain source lineage even though Ensemblis did not perform the generation.

## 8. Loop normalization and seam QA

Generative output cannot be trusted merely because first and last frames were requested.

Add one Media Worker job:

`normalize_loop_video`

Responsibilities:

1. validate codec/container/duration/dimensions;
2. normalize to the canonical loop mezzanine:
   - MP4/H.264;
   - 1080×1920 target when source allows;
   - 30 fps;
   - no audio;
   - web-faststart;
3. sample beginning/end windows;
4. calculate deterministic seam metrics;
5. optionally repair a near-miss seam;
6. upload normalized output;
7. return QC metadata.

Suggested metrics:

- first-frame vs final-frame similarity;
- short-window structural similarity near the boundary;
- luminance/color discontinuity;
- duration/frame-count sanity;
- freeze/corrupt-frame detection.

Exact thresholds should be fixture-calibrated rather than hard-coded from intuition.

### Repair

When the source is valid and the seam is only moderately discontinuous, an **Auto repair** mode may create a short deterministic boundary blend by wrapping the clip against itself and crossfading around the seam.

Repair rules:

- never invent new AI frames;
- never alter the interior creative direction;
- keep repair duration bounded and reported;
- re-run seam QA on the repaired result;
- retain original + repaired assets and provenance.

## 9. Deterministic full-track rendering

The current social finisher already proves the core mechanism by using:

`ffmpeg -stream_loop -1`

Do not duplicate that implementation.

Extract/reuse the loop rendering primitive and add a Media Worker job:

`render_loop_visualizer`

V1 payload concept:

```ts
{
  source_loop_url,
  audio_url,
  upload_url,
  public_url,
  width: 1080,
  height: 1920,
  fps: 30,
  audio_start_ms: 0,
  duration_mode: "full_audio"
}
```

Behavior:

1. download approved normalized loop;
2. determine canonical audio duration with ffprobe;
3. repeat loop indefinitely;
4. trim video exactly to audio duration;
5. mux canonical audio;
6. encode delivery AAC only because MP4 requires it;
7. do not normalize, master, EQ, compress or otherwise modify the track;
8. upload result;
9. capture review frames;
10. return duration/hash/media metadata.

Use a conservative duration safety ceiling appropriate for music (for example 20 minutes), not the current social 120-second ceiling.

Short social outputs should continue using `finish_social_video` rather than the new full-track job.

## 10. Media lineage

Do not create a second asset system.

Use canonical `media_assets` + `media_links`.

Required lineage:

```text
approved artwork/reference
        ↓ source
Loop Kit / generation run
        ↓
raw imported/generated loop
        ↓ normalize/QC
approved normalized loop
        ↓
├── full-track visualizer
└── social finished asset(s)
```

Generated and repaired outputs must not silently replace an already approved public role.

At minimum each derived asset must retain:

- artist;
- release/track/content context;
- parent/source asset;
- generation run when applicable;
- whether source was external or native;
- normalization/repair metadata;
- seam QA result;
- render job;
- output purpose.

## 11. Persistence strategy

Prefer existing durable records:

- `content_items` — creative intent/object;
- `generation_runs` — AI generation and quote/spend lineage;
- canonical media asset/link records — files and use;
- durable media jobs — processing/render execution.

Do not persist a parallel workflow-state table.

The visible stage should be derived from canonical records:

```text
source missing                → Source
source ready, no loop         → Motion / Make loop
generation/import processing  → Make loop
raw loop exists, no approval  → Review loop
approved normalized loop      → Export
```

Add schema only when an existing record cannot represent required durable provenance safely.

## 12. Artist policy and rights

- Native generation requires `visualsAllowed`.
- Loop Kit and importing artist-owned/source media remain available when generative visuals are disabled.
- Existing likeness/brand rules still apply.
- External handoff must make the user responsible for the third-party tool’s terms; Ensemblis should not claim a commercial license on behalf of that provider.
- Ensemblis should store **how the asset entered the system**, not a false assertion that it owns rights.

## 13. Cost policy

Default strategy:

1. reuse existing approved loop if one already exists;
2. offer zero-spend Loop Kit;
3. if native generation is chosen, prefer the cheapest configured loop-capable route that meets the requested quality;
4. quote before spend;
5. never regenerate for duration/aspect delivery when deterministic transformation is sufficient.

This is a direct product-level cost optimization, not merely pricing copy.

## 14. UX rules

- One visible primary action per stage.
- Artist-facing copy uses “loop”, “artwork”, “visual”, “ready”, “repair”, “export”.
- Default UI does not expose “provider”, “SSIM”, “codec”, “worker”, “generation run” or “lineage”.
- Provider/model/quality metrics live under Details.
- Mobile shows the source preview and next action before technical evidence.
- Background generation/normalization can be resumed from Today/Continue.
- If a loop is already approved, “Export” wins over “Generate another”.

## 15. Observability

Record normalized events, not raw private creative text:

- loop_workflow_started;
- loop_kit_prepared;
- loop_generation_prepared;
- loop_generation_started;
- loop_imported;
- loop_qc_completed;
- loop_repaired;
- loop_approved;
- loop_export_started;
- loop_export_completed.

Useful dimensions:

- artist-scoped content/release IDs;
- route type: external / native;
- quality preset;
- provider ID only when native;
- estimated/actual cost;
- seam state;
- repair used;
- render type;
- failure category.

## 16. Acceptance criteria

### Product

- Existing `visual` outcome enters the staged loop workflow.
- Launcher understands artwork/loop/visualizer intents.
- No new primary nav item is added.
- A user can complete the entire workflow with zero AI spend.
- A previously approved loop can be reused without regeneration.

### Native generation

- Only explicitly start+end-capable models are eligible.
- The same source is submitted as first and last frame.
- Spend approval remains mandatory.
- Generated audio remains off.

### QA

- Every imported/generated loop is normalized and checked.
- Near-miss seam repair is deterministic and optional.
- Original asset is retained.
- QA result is visible in artist language.

### Rendering

- Full-track vertical render loops one short video for the exact song duration.
- Full-track audio receives no mastering/dynamics processing during visual rendering.
- Existing social finisher can consume the same approved loop.
- Outputs preserve media provenance.

### Reliability

- Worker contracts are versioned and TS/Python discriminators stay in parity.
- Terminal callbacks remain idempotent.
- Retry does not duplicate approved roles.
- Failed jobs produce one actionable user state.

## 17. Deferred decisions

Defer until implementation evidence requires them:

- whether 16:9 visualizers ship in V1 or immediately after;
- exact seam-score thresholds;
- exact crossfade repair duration;
- direct API adapters for additional loop-capable providers;
- automatic publishing from the export pack.

These do not block the core architecture.
