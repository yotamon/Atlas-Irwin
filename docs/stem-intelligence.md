# Atlas Stem Intelligence

Atlas Stem Intelligence turns synchronized track stems into a reusable musical decision layer for Release Studio, campaign creative generation, and Video Director.

The product goal is not to expose a traditional DAW mixer. Atlas should understand the internal musical anatomy of a release and use that understanding automatically when deciding how a track should be presented in media.

## Product model

The canonical master remains the source of truth for the release. Track Intelligence explains **when** important musical events happen. Stem Intelligence explains **what is happening inside those events**.

The combined model supports decisions such as:

- isolate the vocal identity for a lyric-led Story;
- use drums and bass as a clean movement-led loop;
- remove foreground elements for a voiceover bed;
- reveal layers progressively for a production breakdown;
- begin with exposed vocals and hand off to the mastered track at the payoff;
- preserve the canonical master for maximum-impact release moments.

Atlas calls these reusable treatments **Audio Scenes**.

## Source support

Stem Intelligence is intentionally provider-agnostic. `track_stems.source_provider` currently supports:

- Suno
- Cubase
- Ableton Live
- Logic Pro
- manual files
- other sources

The importer accepts synchronized audio files registered as first-class `stem` assets in Media Library. Common filenames are classified before upload into vocals, drums, bass, percussion, guitar, keys, synth, strings, brass, woodwinds, FX, or other.

WAV is preferred because it avoids an additional lossy encode. Existing Atlas media limits and storage rules still apply.

## Exact-master safety contract

A stem is never treated as an abstract file that can silently follow a track across revisions.

Every `track_stems` row stores `source_master_url`, and the database validates that it equals the track's current canonical `audio_url` when the binding is created or changed.

When the canonical master changes, the database trigger `private.invalidate_stem_intelligence_on_audio_change()` immediately:

1. marks all previous stem bindings `stale`;
2. marks derived Audio Scenes `stale`;
3. clears rendered Audio Scene previews;
4. removes automatically selected stem-intelligence audio treatments from content items;
5. clears Audio Scene references from music-video projects/renders;
6. cancels non-terminal Stem Intelligence worker jobs.

A stale stem can only return to use through an explicit rebind/re-analysis against the current master.

The worker callback repeats the provenance check before accepting any result. A late result produced for an old master is discarded even if the database invalidation has already happened.

System Audio Scenes also carry a `stem_set_fingerprint`. A late preview render is rejected if the set, classification, analysis version, offset, or artist overrides changed while the render was running.

## Stem analysis

`services/media-worker/app/stem_intelligence.py` performs deterministic DSP analysis against both the stem and canonical master.

The current analysis records:

- energy;
- active ratio;
- rhythmic activity / transient density;
- groove stability;
- loopability;
- category-aware hook salience;
- tonal focus and spectral motion;
- best short-form windows;
- activity per Track Intelligence section;
- technical duration, sample rate, and channel count;
- leading/trailing silence;
- onset-envelope alignment against the canonical master.

Alignment is explicit, not assumed. Atlas cross-correlates onset envelopes within a guarded lag window and stores:

- `offset_ms`
- `alignment_confidence`
- alignment method
- correlation
- duration delta

Low-confidence alignment falls back to a zero offset and is surfaced in the Studio UI as a review warning rather than pretending the timing is known.

## Audio Scenes

Audio Scenes are non-destructive JSON mix recipes using schema `atlas.audio_scene.v1`.

A layer references either:

- a Stem Intelligence stem ID; or
- the canonical master.

Layer recipes can specify gain, relative entry/exit time, and fades. URLs are resolved only when a preview render is dispatched, so recipes remain durable when storage credentials expire.

The built-in system scenes are:

### Vocal Spotlight

Lead vocal with restrained atmospheric support. Intended for lyrical identity, intimate Stories, and vocal hooks.

### Groove

Drums, bass, and percussion with foreground melodic clutter removed. Intended for dance, movement, bassline, and seamless-loop concepts.

### Atmosphere

Synths, pads, keys, strings, and FX with rhythmic/vocal foreground reduced. Intended for mood, typography, cinematic teasers, and visual-world content.

### Instrument Spotlight

The strongest non-vocal melodic layer becomes the hero with restrained rhythmic support. Intended for production and musicianship content.

### Voiceover Bed

Vocals are removed and the remaining musical layers are attenuated to leave narration headroom while preserving release identity.

### Build the Track

A progressive-reveal recipe introduces rhythm, bass, melodic identity, and vocals in a musically legible order. Visual systems can mirror the same accumulation.

### Vocal → Drop

An exposed vocal stem creates contrast, then the canonical master enters at the payoff. This deliberately hands the impact back to the mastered mix rather than reconstructing the drop from stems.

### Full Impact

Uses the canonical master directly at the strongest payoff window. Atlas never substitutes a summed stem reconstruction when fidelity is the goal.

### Custom Scene

Artist-defined, non-destructive stem balance with per-layer mute/gain and an explicit time window. Custom recipes are saved first and only rendered when requested.

## Scene generation

`lib/music-intelligence/stems.ts` builds deterministic scene candidates from ready, current-master stems. Track Intelligence supplies preferred musical windows when its stored provenance matches the same canonical master.

`lib/music-intelligence/stem-scenes.ts` persists the system scenes and computes a deterministic stem-set fingerprint. Stable scenes retain their IDs and existing preview assets until the musical inputs materially change.

Scene generation is incremental. As useful stems finish analysis, Atlas can create the scenes that are already supported without waiting for every imported file.

## Preview rendering

Audio Scene previews are rendered by the same durable Media Worker infrastructure used by Track Intelligence and Video Director.

The renderer:

1. resolves recipe stem IDs to current, ready audio assets;
2. applies each stem's measured alignment offset;
3. decodes only the requested preview window;
4. applies gains, entry timing, and fades;
5. sums the scene non-destructively;
6. applies a -1 dB peak ceiling as a safety stage;
7. exports a 320 kbps MP3 preview;
8. registers the output in Media Library as an `audio_preview` asset with source-master, Audio Scene, worker-job, and stem-fingerprint lineage.

Rendered previews are audition assets and content-generation references, not replacements for the canonical release master.

## Durable job model

`track_stem_jobs` supports:

- `analyze_stem`
- `render_audio_scene`

Jobs use the same single-concurrency Vercel Sandbox queue as Track Intelligence and Video Director. This protects the Hobby quota and avoids competing DSP/render work.

Statuses are `planned`, `queued`, `running`, `completed`, `failed`, or `cancelled`.

Each job has an idempotency key, durable request/result payload, callback token hash, external worker ID, and terminal timestamps.

Callback credentials are one-time random secrets. Only a SHA-256 hash is stored in the durable payload, and callbacks use constant-time comparison before reconciliation.

## Release Studio UX

Stem Intelligence appears immediately below the canonical master in the release workspace.

The intended flow is:

1. attach/review the canonical master;
2. import all synchronized stems together;
3. confirm or correct Atlas's filename-based role recognition;
4. let the Media Worker analyze each layer;
5. review layer-level musical metrics and alignment confidence;
6. audition the generated Audio Scenes;
7. pin a treatment when it is artistically important;
8. optionally create a custom mix;
9. allow campaigns and Video Director to reuse the musical intelligence automatically.

The default UX remains automatic. The advanced mixer exists for precise artist control but is not required for normal use.

## Campaign integration

`lib/marketing/creative-context.ts` loads ready Audio Scenes for the release's primary track.

If a content item already names an `audio_scene_id`, that artist selection wins. Otherwise Atlas scores the available scenes against the actual content title, platform, format, hook, content angle, and production notes.

Examples:

- voiceover / tutorial / announcement → Voiceover Bed;
- lyric / singer / vocal phrase → Vocal Spotlight;
- production / layers / behind the track → Build the Track or Instrument Spotlight;
- dance / bass / drums / club loop → Groove;
- teaser / drop / release-day payoff → Vocal → Drop or Full Impact;
- mood / artwork / cinematic visual → Atmosphere.

Artist-pinned scenes receive a strong preference without becoming an unconditional global override.

When a selected scene already has a rendered preview, that preview becomes the creative-generation audio reference. Otherwise Atlas keeps the canonical master as the audio file while still using the scene's musical window and intent as direction.

The creative prompt explicitly tells video generation how the visual mechanism should respond to the treatment instead of placing unrelated AI motion over the music.

## Video Director integration

`lib/video-director/context.ts` injects ready Audio Scenes into the project's music-map context as `stem_intelligence`.

The full music video still renders against the canonical master. Audio Scenes act as creative/editing intelligence: they can inspire layer-reveal mechanisms, vocal restraint, groove-led movement, and payoff timing, and they provide reusable ideas for derivative short-form content.

This keeps one authoritative full-track audio source while giving the Creative Director access to the track's internal musical anatomy.

## Database objects

Migration: `supabase/migrations/20260901173000_stem_intelligence.sql`

Primary tables:

- `track_stems`
- `audio_scenes`
- `track_stem_jobs`

Extended tables:

- `content_items`
- `music_video_projects`
- `music_video_renders`

All new first-class tables use Studio-admin owner-scoped RLS and owner/track validation triggers.

## Operational checks

CI protects Stem Intelligence through:

- TypeScript typecheck;
- ESLint;
- production Next.js build;
- Node architectural contract tests;
- Python bytecode compilation including `stem_intelligence.py`;
- Track Intelligence DSP regression tests;
- clean Supabase migration replay;
- Postgres function lint;
- pgTAP behavior tests including exact-master invalidation.

## Failure behavior

Atlas should fail safely:

- missing canonical master → import is blocked;
- non-audio/non-stem asset → registration is rejected;
- worker unavailable → stem remains visible with a failure state and can be retried;
- low alignment confidence → stem remains usable only with an explicit warning and conservative offset;
- master replacement → old intelligence becomes stale immediately;
- late callback from old master → result discarded;
- late preview from changed stem set → preview discarded;
- scene preview render failure → recipe remains intact and retryable;
- no suitable Audio Scene → campaigns and Video Director fall back to the canonical master.

## Design principle

The implementation should preserve this hierarchy:

**Canonical master → Track Intelligence → Stem Intelligence → Audio Scenes → campaign/video decisions → rendered media**

Stems add understanding and optional derived treatments. They never become a second source of truth for the release audio.
