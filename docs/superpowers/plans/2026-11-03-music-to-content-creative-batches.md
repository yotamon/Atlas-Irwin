# Music-to-Content: Beat-Synced Creative Batches
## Product design, architecture, and executable implementation plan

**Date:** 2026-11-03  
**Status:** Proposed, planning only. No feature implementation or production validation is claimed.  
**Tracking issue:** #291  
**Related:** #130 (outcome-first Create), #129 (music ingestion), #128 (quality), #127 (Paid Growth), #47 (product roadmap), PRs #117 (Quick Video social pack), #280 (UX V5), #286 (Living Artwork), #290 (Release Visual).  
**Repository:** `yotamon/Atlas-Irwin`, canonical branch `main`  
**Owner surface:** `/studio/create`, with contextual Track, Release, Today and Action Launcher entry.

## 0. Decision and north star

**North star:** An artist can select an actual track, hear and compare Ensemblis's recommended musical moments, choose an immediately usable visual direction, and export a coherent, beat-synced pack of multiple distinct promotional videos without opening a video timeline.

**Market lesson:** Viryl's public proposition is "Song in. Ads out.", genre-specific prebuilt videos, beat-synced cutting, timed lyric overlays, commercial stock footage and batch variations. See https://viryl.studio/. These are public marketing claims, not a verified API/SDK integration or a hands-on performance benchmark.

**Ensemblis differentiator:** Music-aware Moment evidence, explicit artist brand/creative permissions, source-master provenance, reusable approved material, safe zero-generative-spend editing, release context, and verified campaign outcomes. Do not clone a generic online video editor.

The user-visible contract:

```text
Choose a track
   -> Ensemblis suggests 3 useful musical sections, with audible previews
   -> Pick "Make promo videos" (or a lyric-led variation)
   -> Choose a visual direction; use approved art/footage by default
   -> Preview 3 intentionally different treatments; edit 4 simple controls
   -> Render a small batch with transparent price, rights and progress
   -> Compare, approve, export a platform-ready pack
   -> Optionally hand off to existing Publish or Growth experiments
```

**Do not:** add a fourth primary navigation item, a parallel media library, an unrelated "Promo Studio", an editor timeline as the default, an autonomous ad launcher, or a new source of truth for the track/master or artist.

## 1. Existing code inventory: reuse before building

Verified against `main` on 2026-11-03. Paths below are existing unless explicitly marked proposed.

| Existing component | What it already does | Gap this project owns |
| --- | --- | --- |
| `lib/studio/create-outcomes.ts`, `creative-directions.ts`, `app/studio/create-actions.ts` | `reach` / `streams` / `lyric` are Moment-owned, `visual` is Release-owned; small ranked directions and source-aware starting | Contextual "make a batch" action and no-timeline variant review rather than another competing Create outcome |
| `app/studio/(protected)/create/page.tsx` | Approved Moment and release-aware entry | Track-first preview and recovery when no suitable Moment is ready |
| `lib/music-intelligence/*`, `lib/studio/moments-curator.ts`, `docs/music-intelligence.md` | Exact-master structure, bars, beats/downbeats, purpose-ranked 6/8/15/30-second cuts | Explicit cut-plan confidence, deterministic visual-edit constraints and render-time exact-master validation |
| `lib/marketing/creative-context.ts`, `creative-treatment.ts`, `creative-dna.ts` | Release/brand/lyrics/stem intelligence and visual direction | Compact curated template recommendation and exact template-to-artist compatibility |
| `lib/marketing/platform-packages.ts` | Platform dimensions, safe areas and format limits | Template-specific responsive layout and preview/export parity |
| `lib/marketing/creative-derivatives.ts` | Image recomposition and video repackaging of existing approved masters | Sibling experiment variants are NOT format derivatives; preserve this distinction |
| `lib/marketing/media-production.ts`, `media-worker-queue.ts` | Durable finishing, job reservation, worker callbacks and capacity handling | Multi-clip template-based social render, small-batch orchestration and partial retry |
| `services/media-worker/app/social_finishing.py` | Deterministic overlay/mux/visual finishing for a single source | Multi-source beat-aware scene assembly with stable, testable edit decisions |
| `services/media-worker/app/video_director_finishing.py`, `lib/video-director/render-finishing.ts` | Caption cues, music-reactive finishing and shot-level rendering helpers | Reuse techniques; do not duplicate a second full Video Director |
| `lib/lyrics-intelligence/timing.ts`, `docs/lyrics-intelligence.md` | Official canonical lyrics, section and activity-assisted line timing | Trustworthy phrase/word transcription and forced alignment: word-level karaoke is NOT currently promised |
| `lib/marketing/release-visual*.ts` and `living-artwork*.ts` | Approved cover-to-social layouts, artwork loops, reusable video derivatives | Treat those assets as high-quality creative inputs, not rival project types |
| `media_assets` / `media_links` / `content_items` / `generation_runs` / `marketing_media_jobs` | Existing durable asset and content production spine | Minimal batch/group + recipe + rights metadata only |
| `lib/marketing/learning-*`, `lib/paid-growth/*` | Source-linked evidence and paid-experiment framework | Attribution from a particular variant/creative decision to verified outcomes, with explicit approval |

**Known risks in existing code:** Shared Vercel Sandbox Hobby capacity, historical worker bootstrap/release drift and recent production migration lag (#263). Source compatibility is not proof that a real production job currently succeeds. Run a live baseline before promising latency or successful publishing. The UX V5 authenticated-browser gate also requires legitimate credentials and must never be bypassed.

### Product boundary

- `Create` is the sole artist-facing owner. Extend the existing `reach` / `streams` / `lyric` intents with a contextual `creative_batch` workflow mode, not new duplicated outcomes.
- `Quick Video` and Director Pro remain the premium/storyboard routes for originally generated full music video production. A creative batch is a cheaper deterministic assembly route.
- `Release Visual`, `Living Artwork`, artist footage and approved library video are potential media inputs.
- `Content Items`, `Generation Runs`, Media Library and marketing delivery are the downstream sources of truth.
- `creative_derivatives` continues to represent platform-format conversions of an approved creative. **Different hypotheses, templates, hooks or footage selections are separately reviewable sibling variants**, not derivative formats.
- Existing autonomy, artist ownership, lyric disclosure and spend approval contracts are authoritative.

## 2. Scope and release boundaries

### Required v1 (alpha-capable)

1. Artist selects a real track/release and a duration objective (suggest 15s hook, 30s discovery, optionally 6s/8s).
2. Ensemblis displays up to three musically distinct candidate Moments, each with source, confidence, duration and playable excerpt. User can pick a safe manual section.
3. Two genuinely distinctive, responsive, zero-generative-spend template families using artist-approved footage/artwork/Living Artwork only.
4. Deterministic beat/phrase cuts and typography overlays with truthful fallback when beat evidence is weak.
5. Three intentional variant recipes by default (range 1-6); user can change hook, source footage/visual mood, copy/lyric treatment, and rhythm/pace without a timeline.
6. Low-cost review preview, durable rendering to 1080x1920 H.264/AAC and platform-safe output; reusable full-quality assets.
7. Clearly labeled statuses and retry of failed variants without duplicating completed ones.
8. Review/approve/download and optional handoff to existing publishing controls. No automatic external effects.
9. Mobile and desktop parity at the decision level, accessible preview and exact source/right lineage.

### v1.1

- Line-timed lyric templates with artist-approved canonical text and reliable manual corrections.
- A narrowly licensed, contract-verified commercial footage source if its provider permits required use, plus rights-expiry/revocation enforcement.
- More curated template families only after v1 quality is measured.

### v1.2

- Optional provider-based word/phoneme alignment behind reviewable confidence, language support and per-job cost cap.
- Variant-linked Growth experiment preparation, readback and approved learning, only with verified source performance and valid attribution.
- Additional output formats and higher volume after render/queue cost is proven.

**Explicit non-goals:** copy Viryl footage or template designs; scrape or download third-party clips without rights; build a DAW/video-timeline editor; automatic campaign spend; infer performance uplift from visual aesthetics; distribute all media globally without verifying territory/usage restrictions; deepfaked faces/voices without explicit artist policy.

## 3. User journeys and interaction contract

### 3.1 Golden path: instrumental or vocal single

**Entry:** Track → "Make promo videos"; Release → "Promote this release"; Create → existing `reach`; Today/Launcher → "Make three Reels for [track]".

Four progressive screens, with resume-on-return:

1. **Music**: track title, artwork, source-master readiness, play button and at most three recommended complete musical windows. A single "Use another section" control reveals precise manual start/end. Do not show BPM/analyzer vocabulary by default.
2. **Look**: 2-3 visual direction cards with truthful preview still/short video, explanation of match to the artist, media-source status ("Your footage" / "Artwork" / "Licensed", not mixed invisibly), and price label ("No AI generation cost" for deterministic route). Select a direction.
3. **Variations**: three side-by-side/mobile-swipe tiles. Four editable chips: **Section**, **Look/Footage**, **Opening message**, **Pace**. "Make another version" creates a *materially different* recipe. No video timeline and no requirement to know an underlying template ID.
4. **Review & Use**: low-resolution preview when possible, render job states, duration and rights badges; inspect first second, compare outputs, approve/reject, retry failed only, download approved media/manifest, or hand off to schedule/publish and Growth.

Always show one dominant next action. Keep advanced inspector controls (beat grid, crop anchor, clip list, lyrics timing and renderer traces) behind "Adjust details". Preserve source-context and artist identity on refresh and deep links.

### 3.2 Fallback journeys

- **No music or canonical master**: link to Add Music or the track's source readiness; never fake a playable preview.
- **Analysis not ready**: start or resume existing ingestion/analysis; allow optional clearly labeled manual timing if source is valid, with unsynced/limited claims.
- **No approved Moment**: offer a safe manual excerpt from the current master without fabricating an approved Moment or silently modifying the ranking.
- **Instrumental track**: hide lyric-driven overlays; keep visual templates fully capable.
- **Missing artist media**: use approved cover/Release Visual/Living Artwork and zero-spend motion graphic treatments; don't send user to stock checkout as a prerequisite.
- **Weak beats/downbeats**: use section-aware/energy-aware soft edit or fixed cadence; UI says "Rhythm-aware" or "Timed cuts", never "beat-perfect" on inferred evidence.
- **Lyrics unavailable/uncertain**: use instrumental/typographic hook option. Transcripts are drafts, not official lyrics; disable lyric-export until artist confirms rights and text.
- **Unavailable Sandbox/quota**: persist queue status "Waiting for capacity", do not call it a failed creative; no automatic paid provider fallback.
- **Rights expired or unknown**: block third-party media export/publishing. Offer asset replacement and a new deterministically invalidated render; preserve owned artwork path.
- **Master/lyrics changed**: mark dependent plan, alignment and render stale by source fingerprints; keep old outputs in history with clear stale labels; no reuse as current-version approved creatives.

## 4. Core domain and data model

### 4.1 Batch, variant and recipe

Create the *minimum* new domain relationships necessary for grouping and regeneration:

- **Proposed `creative_batches`**: `id`, `owner_id`, `artist_id`, `release_id`, `track_id`, `campaign_id` (nullable), `source_master_asset_id`/`source_audio_sha256`/`music_analysis_version`, objective, target platforms, schema version, status, timestamps and created_by. One batch is an artist-owned work order.
- **Proposed `creative_batch_variants`**: `id`, `batch_id`, `owner_id`, `artist_id`, `content_item_id`, `generation_run_id` (nullable), `template_id`, `template_version`, `recipe_version`, `recipe_json`, `recipe_fingerprint`, `source_moment_id` (nullable), `source_fingerprint`, `render_job_id` (nullable), explicit review status, current approved asset ID (nullable), created_at/updated_at. These rows are **group/recipe indexes**, not replacements for Content, Generation or Media records.
- **Proposed `creative_asset_rights`**: only if required data cannot be cleanly represented by an existing canonical rights model. Store validated asset/provider/license IDs, grant scope (organic, paid/social, formats, platforms, territories, term), commercial use and derivative permissions, attribution/receipt evidence, grant version, expiration/revocation state, and reviewer. A user-owned asset carries ownership/permission evidence; do not assume it is cleared merely because it was uploaded.

Migration must use additive constraints, artist/workspace RLS, artist lineage checks, composite indexes and defensive uniqueness. All writes verify artist membership and release/track/content/asset linkage on server. Service-role callbacks must recheck this lineage. No client-supplied URL/provider/artist ID is trusted as authorization.

Batch metadata is durable, but the canonical approved media lives in `media_assets`; publishable creative and its copy live in `content_items`; audit/model/provider events live in `generation_runs`; worker state lives in `marketing_media_jobs`.

### 4.2 Versioned recipe contract (proposed)

```json
{
  "version": "ensemblis.creative_batch_recipe.v1",
  "track": {
    "id": "track-uuid",
    "masterSha256": "actual-sha256",
    "momentId": "optional-approved-moment-id",
    "windowMs": [10000, 25000]
  },
  "template": { "id": "editorial-pulse", "version": 1 },
  "musicGrid": {
    "source": "model | inferred_from_beats | none",
    "confidence": 0.92,
    "algorithmVersion": "edit-grid-v1"
  },
  "scenes": [
    {
      "startMs": 0,
      "endMs": 2200,
      "mediaAssetId": "uuid",
      "sourceInMs": 0,
      "framing": { "focusX": 0.5, "focusY": 0.5 },
      "motion": "none",
      "transition": "hard-cut"
    }
  ],
  "graphics": {
    "openingText": "OUT NOW",
    "lyricCueIds": [],
    "styleId": "artist-editorial",
    "fontTokens": ["approved-family"]
  },
  "outputPackageId": "instagram-reel",
  "sourceRightsVersions": ["per-asset-rights-proof-version"]
}
```

IDs/values above are illustrative, not existing database API values. Authoritative schema should be validated at both UI and server/worker boundaries. Keep recipe data self-contained and immutable *per submitted render*, so UI edits create a new fingerprint and render version.

Fingerprints must include exact master bytes and music evidence, clip asset IDs + immutable content versions, timing, template+style version, crop/text, lyric version/permissions, rights versions and output package. A stale changed input invalidates output eligibility. Existing completed recipes may be reused under an identical fingerprint, never for newly changed inputs.

### 4.3 Template strategy

Templates are **versioned original Ensemblis composition recipes**, not AI prompts or unlicensed Viryl clones. Start with:

- **Editorial Pulse**: artwork/real-footage focus, clean typography, restrained color treatments, hard or soft cuts on trusted musical events.
- **Club Motion**: groove-led movement, kinetic crop/reframe and layered repetition suited to dance music, but respectful of accessibility and artist visual exclusions.

Third template after benchmark: **Lyric Spotlight**, using only artist-confirmed lines, timing confidence and safe text overlays.

Each template declares allowed source kinds, length range, aspect ratio, safe area, max clip count, typography semantics, tempo/energy needs, motion budget, accessibility alternatives and source fallback. The template recommender can use artist genre/context and Creative Memory **within bounded permissions**; an aesthetic preference is not authorization for synthetic likeness, paid media or third-party licensing.

**Do not manufacture hundreds of cosmetic duplicates.** Each initial batch should intentionally differ on 2+ meaningful axes (e.g. opening hook, selected Moment, first-frame visual or message), display differences to the artist, and de-duplicate near-identical recipe hashes.

## 5. Deterministic video assembly

### 5.1 Beat-aware edit planner

Build a pure TypeScript/Python-testable planning boundary rather than mixing creative reasoning into FFmpeg string construction:

1. Resolve exact canonical audio and valid approved or manually selected window.
2. Read current exact-master Track Intelligence evidence. Preferred rhythm provenance is measured downbeats/beats; an inferred bar grid is distinct from measured rhythm; missing evidence is not fabricated.
3. Generate candidate cut anchors within the window using verified beats/downbeats, section entrances and phrase boundaries. Cap cut density, minimum scene length and repetition. Start and end must match window bounds exactly.
4. Score scene boundaries for rhythmic strength, phrase continuity, first-second impact, required lyric cue clarity and visual continuity; reject too-fast flashing/strobing.
5. Map allowed licensed/owned clips into scene slots with sufficient duration, source quality, aspect suitability, brand exclusion checks, source-in offsets and repeat penalties.
6. Persist this edit decision (grid provenance, confidence and fallback rationale) in the recipe. Never move approved lyric cues to create a fake beat match.
7. If no credible rhythm grid, use a transparent section-aware or fixed edit strategy and mark it as such.

Candidate timing precision: accepted beat-aligned cut boundaries must be frame-quantized and within one output frame of their selected event at the configured FPS. This is a **deterministic engineering tolerance**, not a claim that estimated beats are perceptually correct. Benchmark actual beat detection separately against human judgments.

### 5.2 Preview/export parity

Implement **one canonical compositor/manifest** consumed by both preview and final render. UI preview can be lower resolution or downsampled, but it must not silently show a different edit, typography, crop or music window from export.

Prefer a deterministic preflight of a few representative frames or short sample over expensive full preview rendering. User-facing preview status must say whether it is exact-render or representative. On changes, show outdated previews as stale until regenerated.

Extend the existing Media Worker dispatch/queue and finishing techniques. Possible implementation paths:

- **Proposed** `lib/marketing/creative-batch/*`: schema, template registry, edit planner, rights, render manifest, orchestration, state projections.
- **Proposed** `services/media-worker/app/creative_batch.py`: bounded multiclips + overlay + exact-source audio trim + MP4 assembly. Register a job type through the current media-worker contracts/runner. Extract reusable code from `social_finishing.py` if it reduces duplication.
- Current `marketing_media_jobs` and shared Sandbox capacity circuit remain the job authority. Do not add an independent queue or per-variant worker process.
- Perform analysis on full source only once per valid fingerprint; derive variants and formats from approved reusable asset data where possible.

Default export contract: 1080x1920 vertical, H.264/yuv420p video, AAC audio, supported FPS and platform package, correct duration, first-frame salience, safe-area validated typography, no unexpected letterboxing/stretch, source-master audio excerpt (trim/encode only, **no re-mastering or loudness/dynamics changes**). Any unavoidable audio encoding difference must be stated and measured.

Automatic fail gates: missing/unapproved media, wrong artist, rights uncertainty, absent/incorrect audio, malformed render, wrong dimensions, duration drift, source hash drift, clip corruption, unreadable overlay or serious flashing risk. Keep successful sibling variants if one fails.

### 5.3 Budget and capacity

- Own/artwork deterministic batch calls no paid image/video-generation provider.
- Show an estimate including compute/storage/egress categories, not a fictional "$0 total cost"; app resources still cost something.
- When a premium/generated clip is requested, use the existing specialist quote -> explicit approval -> reserve -> reconcile protocol. Never auto-retry an ambiguous paid submission.
- Default small-batch execution (1-6) with rate limiting and per-artist fair capacity. Shared Sandbox stays bounded by current Hobby/runtime limits, and pending jobs survive provider quota.
- Fingerprint/idempotency key = artist + batch variant + immutable recipe + output package. Callback replay does not create duplicates. Cancellation stops new work; completed media/history remains traceable.
- Each job has visible status: Draft, Needs source, Queued, Waiting for capacity, Rendering, Needs review, Ready, Failed/retryable, Blocked by rights, Superseded.

## 6. Lyrics: ship truth, not karaoke theater

Existing lyric ingestion stores canonical official text with media permissions, versioned analysis, aligned sections and approximate line timings. It explicitly **does not** promise word-level forced alignment. Existing Video Director already supports time-ranged caption cues; reuse that contract.

### v1 safe lyric template

- Show verified exact official lyric lines only when current lyrics version has media-quote permission.
- Allow artist to review/correct line boundaries in a compact cue inspector.
- Select line/phrase cues that intersect the approved music window; do not silently rewrite lyrics.
- Block unsupported mixed-language, non-speech, instrumental, absent permission and stale-lyrics situations from pretending precise word karaoke.
- Graceful fallback to hook text or visual-only treatment.
- Timed line overlays must respect reading time, safe areas and text contrast.

### v1.2 optional automatic alignment

Do a provider/OSS **evaluation spike before choosing an engine**. Compare transcription -> canonical-text matching -> forced alignment quality on sung vocals, effects-heavy AI vocals, repeated lines, Hebrew/English and instrumental false positives. Use vocal stem if legitimately available. Track language, confidence, latency, data rights and per-minute cost.

Do not accept a transcript as canonical lyric truth. The artist approves corrected text, where required, before export. Word-level cues stay versioned and subordinate to official lyric permissions. Low-confidence timing needs an editable review or line-level fallback. Require explicit evaluation thresholds before release.

## 7. Media sources and commercial rights

P0 uses first-party artist-owned footage, approved release art, Release Visual, Living Artwork and compatible existing Media Library assets. It should work with **no stock provider** and **no paid image/video provider**.

P1 stock licensing is a separate commercial/legal integration track:

1. Investigate providers with an actual documented API/SDK or negotiated catalog license; verify access, costs, video format, caching/storage, derivative and sublicensing rights, ad/organic usage, platform/territory/term scope, revocation, attribution and use after subscription cancellation. An attractive marketing page is **not** a license grant.
2. Only implement the provider adapter once the contract and data lifecycle are approved. Avoid scrapers, hotlinked uncontrolled assets, watermark removal and shadow libraries.
3. Persist rights evidence at acquisition and export, including exact asset/version and usage scope. Revalidate at render, download package and publishing. If a license cannot be proven or expires, remove eligibility and offer owned-asset substitution.
4. Treat branded footage, artist likeness, logos, faces, releases and AI-generated imagery according to existing artist creative policies.
5. Add deterministic source recommendations by visual compatibility, license eligibility, duration and first-frame strength. Keyword/color search alone is not sufficient.

Do not put paid stock bytes, provider credentials or non-redistributable sample assets into the public MIT repository.

## 8. Downstream campaign, attribution and learning

An approved variant is an independently testable `content_item`, linked to its `creative_batch_variant`, template recipe, exact Moment/window, source media and optional existing Growth experiment.

- Support manual export, draft publication and campaign proposal; external publishing follows existing account connection/consent/approval flows.
- Preparing a paid experiment does not launch ads, configure payment or spend money; always honor existing spend ceilings and approval contracts.
- Record platform publication IDs, verified provider performance snapshots, Smart Link attribution where supported, measurement window, budget and audience/placement context.
- Separate **observed** outcomes from estimated reach, provider-reported metrics and unknown conversion attribution.
- A/B tests must compare like-for-like audience/budget/time when feasible; otherwise report confounding and avoid causal winner claims.
- Reuse the bounded `Moment -> creative -> publication -> metric -> approved learning` contract. No automatic artist-memory update from insufficient or non-reconciled evidence.
- Let the artist see *why* Ensemblis suggests repeating or rejecting a creative pattern.

## 9. Implementation slices and exact file ownership

Prefer **small reviewable PRs** under #291, with one canonical design and the following ordered deliverables. Avoid a multi-thousand-line unreviewable implementation PR.

### M0: Baseline and design contract (PR 1)

**Modify:** `lib/studio/create-outcomes.ts`, `lib/studio/creative-directions.ts`, `app/studio/(protected)/create/page.tsx`, intent resolver, UX docs as appropriate.  
**Add:** `lib/marketing/creative-batch/domain.ts`, `templates.ts` (proposed), contract tests, acceptance dataset manifest.

Tasks:
- [ ] Run a live read-only baseline on current Track -> Create -> render, including authentic mobile session, current Sandbox status, production schema and worker SHA. Record broken paths before changing them.
- [ ] Finalize canonical `creative_batch` mode within existing `reach`/`lyric` without duplicating `visual`/`loop`/`Quick Video`.
- [ ] Define versioned recipe, preview, variant sibling semantics, source provenance, rights policies and flag defaults.
- [ ] Ship contextual entry, page skeleton and honest no-analysis/no-rights/no-Moment states.
- [ ] Add source-artist and selected-track authorization tests.

**Gate:** No extra top-level feature/nav; stable intent resolution, lawful artist scope, safe fallback and source provenance tests pass. No claim of rendering yet.

### M1: Deterministic template and edit engine (PR 2)

**Proposed:** `lib/marketing/creative-batch/edit-grid.ts`, `recipe.ts`, `template-registry.ts`, `services/media-worker/app/creative_batch.py`.  
**Modify:** media-worker job contract/runner/bootstrap and `social_finishing.py` only for reusable utilities; extend platform package behavior without altering existing outputs.

Tasks:
- [ ] Build pure edit-grid planner with provenance and conservative fallback.
- [ ] Build two original template families and durable source/clip selection.
- [ ] Add exact-source audio trim, FFmpeg scene concat/reframe/graphics, QC and source hash checks.
- [ ] Implement representative preview, final render from the same recipe and output artifact inspection.
- [ ] Protect zero paid-provider path and shared Sandbox capacity.

**Gate:** 15s/30s exports using only existing assets on a seeded test track, frame-quantized event cuts, correct music window/audio and mobile-safe graphics. No new image/video generation calls.

### M2: Batch orchestration and no-timeline UX (PR 3)

**Proposed:** additive migration for `creative_batches`/`creative_batch_variants`, typed DB contracts, `app/studio/creative-batch-actions.ts` and a contextual `/studio/create/batch/[id]` route/component.  
**Modify:** existing marketing media queue, Media Library and content-item integration.

Tasks:
- [ ] One batch = 1-6 sibling variants; default 3 meaningful hypotheses; stable edit/change/fingerprint behavior.
- [ ] Durable progress and resume, cancellation and retry failed only.
- [ ] Preview/change/export parity, compare and approve/reject workflow; identical recipe dedupe.
- [ ] Per-variant Media Library and Content lineage; platform derivatives only after approved master.
- [ ] Desktop/mobile accessibility and authenticated journey tests.

**Gate:** Three distinct variants can be created, reviewed, rendered and downloaded from one approved track with <=4 artist-facing steps and no timeline or duplicative content items. Refresh/redeploy/replayed callbacks preserve state.

### M3: Lyric-first creative quality (PR 4)

**Proposed:** lyric-render cue adapter and timed-text inspector; no new parallel lyric database.  
**Modify:** lyric/create/render integration only.

Tasks:
- [ ] Canonical approved line-text selection with quote policy, version and staleness checks.
- [ ] Line boundary confirmation UI, typed cue graph, readable overlay styles and strict safe-area rules.
- [ ] Add media-worker lyric rendering and approval tests across vocal/AI-assisted/instrumental/reference cases.
- [ ] Optional forced-alignment feasibility spike; defer provider adoption until quality, price and licensing gates pass.

**Gate:** No hallucinated official lyrics or false word-precision, stale lyric export, unapproved text or inaccessible captions.

### M4: Commercial footage provider and rights (PR 5, conditional)

**Proposed:** rights evidence migration, provider-neutral footage adapter, eligible-source UI; **do not implement until legal/provider proof passes**.

Tasks:
- [ ] Provider due diligence and signed use-case matrix.
- [ ] Provider adapter with quotas, rights evidence and artist boundary enforcement.
- [ ] Provider-safe search/pin/curated-board flows and permitted asset caching.
- [ ] Rights revocation/expiry tests across render, export and publish.
- [ ] No stock-provider fallback remains a fully supported v1 path.

**Gate:** Provider license demonstrably covers exported commercial uses. No public/paid output without recorded valid rights proof. Rollback cleanly disables provider while preserving owned-asset workflow.

### M5: Growth and experiment integration (PR 6)

**Modify:** current `content_items`, existing experimental Growth/readback integration, structured creative learning consumers.

Tasks:
- [ ] Variant -> platform publish/draft -> provider metrics -> verified experiment mapping.
- [ ] Explicit opt-in experiment preparation with sensible budget and stop conditions.
- [ ] Results comparison only on genuinely comparable samples; evidence and confidence displayed.
- [ ] Bounded approved preference learning with zero cross-artist leakage.

**Gate:** No automatic spend/publishing; only verified outcomes influence artist memory or recommendation rankings.

### M6: Reliability, rollout and closeout (PR 7)

- [ ] Run full targeted + studio suite, TS typecheck/lint/build, Python DSP/render tests, clean Supabase migration replay, pgTAP/RLS and worker bootstrap closure test.
- [ ] Run authenticated Playwright journeys on legitimate test state for mobile and desktop with accessibility scans; do not bypass auth.
- [ ] Use real catalog benchmarks and documented visual review (Section 10).
- [ ] Validate deployment serving SHA, prod migration parity, actual media-worker version/queue behavior, callback reconciliation and provider spend ledger before increasing exposure.
- [ ] Update roadmap and docs with truthful shipped vs pending state, operator runbook, failure recovery and rollout evidence.
- [ ] Enable only after baseline and smoke tests pass; keep feature flags for quick rollback.

## 10. Quality strategy, fixtures and measurable acceptance

### 10.1 Representative benchmark corpus

Keep real artists' audio out of the public repo unless explicitly cleared; use secure test assets/fixtures and source fingerprints. At minimum:

1. **Atlas Irwin - "Can't Stop Watchin'"**: vocal hook, lyric timing, repeated words, brand and 15/30-second creative.
2. **Atlas Irwin - "Disco Fever"**: groove/phrase rhythmic edit and instrumental-capable fallback, if the actual file and lyrics state support it.
3. **Cerebro Spinal** (with artist's permission): traditional psytrance artist, instrumental/long build and an intentionally different visual identity.
4. Synthetic/reproducible test audio: stable 4/4 click, changing tempo, off-grid intro, silence and clipped/problematic sources.
5. Rights and failures: missing stock grant, expired grant, insufficient source duration, stale master, callback replay and over-quota worker.

Do not presume private catalog files or a beta tester's tracks are legally available in CI. Artist permission is a prerequisite.

### 10.2 Definition of done: experience

- [ ] The artist can start from an existing Track/Release and finish a useful first batch with <=4 visible steps, no timeline, and no unexplained internal terms.
- [ ] Up to three section suggestions are playable, show uncertainty and never invent audio analysis.
- [ ] At least three *visually/materially distinct* variants, not mere different text colors; compare first 1s and meaningful creative differences.
- [ ] On phone and desktop, preview/selection/approval/export are fully operable and screen-reader accessible.
- [ ] Every creative declares asset source, lyric/source permissions and price/spend before render.
- [ ] Existing Release Visual, Living Artwork and Quick Video paths still work unchanged.

### 10.3 Definition of done: rendering and music

- [ ] A verified-grid aligned edit is within one output frame of selected cut events at 30 FPS; weaker grids are labeled and use safe fallbacks.
- [ ] The final audio is taken from the exact current canonical master and exact authorized time window; no dynamic processing/remastering.
- [ ] Renderer, metadata and ffprobe agree on format, duration, dimensions, stream presence, frame rate and output hash.
- [ ] No stretching, black frames, unintended silence, cover deformation, lyric overflows or text in UI unsafe areas in benchmark samples.
- [ ] Preview is either representative and clearly labeled, or proven recipe-equivalent to final export.
- [ ] Broken/stale/missing inputs fail safely and preserve prior approved assets without overwriting.

### 10.4 Definition of done: costs, safety and ops

- [ ] Deterministic owned-media path has zero third-party *generation* calls; measured compute/egress/storage costs are visible separately.
- [ ] Every paid provider call has a quote and explicit approval, no ambiguous automatic retry.
- [ ] Every render can recover from refresh, duplicate callback, worker quota, deploy and partial batch failure without duplicating billable work.
- [ ] No cross-artist read/write/render; auth and database RLS tests validate both interactive and service-role flows.
- [ ] No third-party media without verified grant at export/publish time; no lyric text without approved canonical media rights.
- [ ] Downloaded media and retained raw assets have explicit retention/rights and delete/export semantics.

### 10.5 Performance SLOs (targets to validate, not current claims)

Record p50/p95 on 20 real jobs per template/source type on the deployed plan and a separate synthetic deterministic fixture run. Initial targets:

- **Preview readiness:** p50 <=30s for an already-analyzed 15s track and cached owned clips, excluding intentional queue waits. Document queue waits distinctly.
- **Export reliability:** >=95% successfully completed renders across a 20-job healthy-capacity smoke batch, with no source/right/QC failures hidden as successes.
- **Artist steps:** <=4 distinct primary workflow stages, <=3 required active decisions after selecting the track on the recommended/default path.
- **Cost:** record absolute and per-variant compute, transfer, storage and third-party spending. Do not promise Viryl's unit price before measurement.
- **Timing/lyric:** deterministic frame precision for selected measured rhythm events; lyric alignment quality judged on an explicitly consented annotated benchmark. Set word-level thresholds only after the alignment spike.

Do not use a model's self-graded visual score as a substitute for audio QC, source-right checks or user judgment. Include manual blinded visual review of each representative case.

## 11. Security, migrations, rollout and rollback

- Feature flags default **off** for public tenants. Proposed server-side `ENSEMBLIS_CREATIVE_BATCH_ENABLED` (not an existing env var) and separate stock/alignment flags. Artist-specific allowlist for beta.
- Migration order: additive schema and RLS -> typed API and server-scoped actions -> durable worker -> UI entry -> optional external sources -> publishing links. No flag-day removal of legacy content.
- All callbacks check one-time token/hashed credential, allowed job, signed upload target, bounded file size and artist/recipe lineage. Validate remote media URLs against the existing SSRF policy and keep secrets server-side.
- Prefer allowlisted MIME/codec/size/duration from authorized media assets, not arbitrary external URLs.
- Strict ownership: profile != workspace != active artist; service-role bypass must use explicit artist ID and defend against unrelated valid IDs.
- Per-job typed error mapping and retry contract, alert on render failure/quota excess, high bytes egress and unbounded pending age. No new unmetered long-running background task.
- Rollback by flag: disable new batch starts and third-party source use while preserving already-created edits and readable output; don't silently cancel or delete existing approved media.
- Authenticated acceptance needs an authorized test account, matching Vercel serving SHA, production Supabase migration parity and worker contract. If these cannot be verified, call product state **implementation complete, production acceptance pending** rather than "production ready".

## 12. Dependencies, unknowns, and decision gates

| Decision | Default / next action | Blocker |
| --- | --- | --- |
| Product placement | Current Create + contextual Track/Release action | None |
| Data ownership | Existing Content/Generation/Media with minimal batch/recipe grouping | Schema review before migration |
| Template engine | Original versioned deterministic templates, owned media first | Preview/export parity and mobile quality |
| Render stack | Existing Media Worker + shared capacity circuit | Baseline worker/queue health |
| Beat editing | Exact-current-master Music Intelligence | Truthful provenance/fallback |
| Lyrics | Current canonical official lines first | Word-level claim requires alignment quality benchmark |
| Stock footage | Not needed in P0 | Written commercial/API rights and compatible licensing economics |
| Performance | Reuse actual verified Growth/Smart Links signals | No cross-campaign causal claims |
| Beta | Atlas Irwin dogfood; Cerebro Spinal with consent | Real-track and authenticated browser acceptance |

### Suggested execution order

**First implement M0 -> M1 -> M2** to deliver a compelling low-cost workflow for imminent Atlas releases. Then complete M3; treat M4 as conditional on provider commercial feasibility; complete M5 as the performance differentiation once real usage exists. Run M6 gates at every release boundary, not only at the end.

**What success looks like:** Ensemblis becomes a place where the artist can make the next excellent promotional assets in minutes *because it understands the song*, not despite its deep underlying product complexity. The app should ship fewer better creatives with explainable musical reasons, a trustworthy price/rights model and a testable path to verified learning.

## 13. Operator/user handoff checklist (after implementation, not yet performed)

- [ ] Approve the artist-owned media/lyrics to use in the real-content test corpus.
- [ ] Review provider footage licensing/paid API credentials only if opting into M4.
- [ ] Provide legitimate authenticated browser-test credentials or execute the documented browser acceptance yourself.
- [ ] Apply/reconcile the protected production migrations via the standard deployment process.
- [ ] Confirm Vercel/worker runtime and feature-flag exposure; run one real media output through the end-to-end path on mobile and desktop.
- [ ] Explicitly approve creative content and each external publish or paid campaign action.

## 14. Out of scope of this planning PR

This plan does **not** modify runtime code, migrations or production settings. No videos were rendered, external footage was licensed, provider keys were installed, ads were launched or creative quality was physically benchmarked during planning. Task status must be tracked in #291 and implemented in reviewable code PRs with evidence against the gates above.
