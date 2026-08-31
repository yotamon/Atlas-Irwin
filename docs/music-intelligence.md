# Atlas Track Intelligence v3

Track Intelligence is the canonical musical understanding layer for Atlas Studio. A master is analyzed once, tied to the exact audio that produced the analysis, inspected by the artist, and then reused by Growth OS, Marketing, Content Lab, Video Director and derived renders.

## Production contract

Atlas should answer these questions without requiring manual timestamp hunting:

- What is the musical structure of this exact master?
- Where are beats, downbeats, bars and useful phrase boundaries?
- Which musical ideas recur semantically rather than merely sharing the same chords?
- Which moment is best for an instant hook, musical identity, groove loop, build/drop, climax or story arc?
- Which alternatives work best for 6s, 8s, 15s and 30s media?
- How trustworthy is each part of that interpretation?
- Is there a technical master problem that should block production?
- Can the artist audition every decision before Atlas spends generation budget?

## Pipeline

```text
Master / Vault audio
  -> durable Media Worker queue (concurrency 1)
  -> source SHA-256
  -> lossless 44.1 kHz PCM analysis decode
  -> All-In-One
       |-> semantic sections
       |-> beats / downbeats
       |-> frame activations
       `-> semantic embeddings
  -> librosa temporal / harmonic / rhythm features
  -> bars + phrase grid with provenance
  -> purpose-specific candidate ranking
  -> 6s / 8s / 15s / 30s primary + alternate cuts
  -> master QC
  -> canonical track_music_intelligence cache
       |-> Growth OS / Vault
       |-> Content Lab timestamps
       |-> Marketing creative context
       |-> Video Director timing
       `-> derived renders
```

The Media Worker runs only in Vercel Sandbox. Heavy work is serialized through durable Atlas state rather than rejected when the free worker is busy. Terminal callbacks drain the next queued job.

## Exact-master identity

A v3 result contains:

```json
{
  "source_audio": {
    "url": "https://.../master.wav",
    "media_asset_id": "...",
    "audio_sha256": "...",
    "analysis_pcm_sha256": "..."
  }
}
```

The raw source hash identifies the bytes Atlas downloaded. The PCM hash identifies the standardized decode used by the analyzer.

The canonical cache accepts a result only when its source URL matches the track's current master. Vault-linked results additionally use `media_asset_id` when available. Both callback paths reject late results if the master changed while a job was running.

Replacing `tracks.audio_url` invalidates:

- canonical Track Intelligence for that track
- worker-derived Video Director maps
- only Content Lab timestamps whose provenance is `music_intelligence`

Manual timestamps are preserved.

## Rhythm provenance

Downbeats are no longer represented as a misleading boolean. The map records:

- `model` — actual downbeats returned by the semantic model
- `inferred_from_beats` — an editing/bar grid inferred from beat timing
- `synthetic_grid` — reserved for explicit synthetic timing
- `none`

`analysis.real_downbeats` remains as a compatibility field and is true **only** for `downbeat_source = model`.

This matters because storyboard alignment may trust verified downbeats more strongly than an inferred grid.

## Structure, bars and phrases

All-In-One runs with activations and embeddings enabled. Atlas uses its segment/label activations to expose section confidence instead of assigning a generic confidence to every semantic result.

Bars use downbeat provenance. Phrase boundaries are currently a transparent four-bar inference constrained by semantic sections, with provenance recorded on every phrase. Atlas does not claim inferred four-bar groups are model-detected phrases.

If All-In-One cannot complete, librosa produces explicit fallback structure and rhythm. A duration-only estimate still never invents hooks.

## Semantic recurrence

v2 compared averaged 12-bin chroma fingerprints. That remains useful as `harmonic_recurrence`, but it cannot reliably distinguish two passages that share harmony while carrying different musical ideas.

v3 summarizes All-In-One embeddings inside each candidate window and compares non-overlapping windows of similar duration. This produces `semantic_recurrence`, which is the preferred repetition/identity signal.

Compatibility aliases remain temporarily available:

- `repetition` -> semantic recurrence
- `melodic_salience` -> harmonic distinctiveness
- `loopability` -> boundary loop fit

New code should use the explicit metric names.

## Purpose-specific moments

There is no single universal hook objective. Every candidate receives a score for:

- `instant_hook`
- `musical_identity`
- `groove_loop`
- `build_drop`
- `climax`
- `story_arc`

The canonical `score` remains for backward-compatible overall ranking, but production systems should prefer the intent that matches the creative job.

For example, `instant_hook` emphasizes immediate lift, rhythmic activity and recurrence, while `story_arc` emphasizes internal development, structural position, novelty and payoff.

## Social cuts

v3 stores both:

- `social_cuts` — the backward-compatible primary choice
- `social_cut_options` — up to three musically distinct alternatives per duration

Objectives differ by duration:

| Target | Primary objective |
| --- | --- |
| 6s | immediate impact + clean loop |
| 8s | impact + identity + groove |
| 15s | identity + hook/payoff |
| 30s | mini narrative / story arc |

Cuts stay near musically meaningful boundaries, so exact duration can differ slightly from the nominal target.

## Candidate metrics

The explainable v3 feature set includes:

- energy
- energy lift
- onset / rhythmic activity
- groove stability
- semantic recurrence
- harmonic recurrence
- harmonic distinctiveness
- novelty versus preceding context
- structural importance
- section confidence
- boundary / edit-grid fit
- boundary loop fit
- internal arc strength

The Inspector exposes these values rather than presenting a score as unexplained AI judgment.

## Confidence

`analysis.confidence` contains separate normalized signals for:

- `rhythm`
- `downbeats`
- `structure`
- `hooks`
- `overall`

Where All-In-One activations are available, confidence uses model evidence. Fallback analysis reports lower confidence and honest provenance. These values are ranking/review confidence, not statistical probabilities of correctness.

## Master QC

The analysis decode is also inspected for production-critical technical issues:

- integrated LUFS
- sample peak
- estimated 4x-oversampled true peak
- RMS and crest factor
- clipping sample count / ratio
- stereo correlation
- DC offset
- leading / trailing silence
- decoded sample rate and channel count

`technical_ready` becomes false only for a blocking defect such as clipping. Other suspicious conditions are warnings so Atlas does not pretend one mastering target fits every genre or distributor.

QC is calculated from Atlas's standardized lossless PCM analysis decode. It does not currently claim to report the original container's bit depth or codec metadata.

## Production review UI

The Video Director inspector lets the artist hear:

- every detected section
- ranked candidates
- the best candidate for each production intent
- primary social cuts
- alternate social cuts

It also displays:

- detected vs inferred rhythm provenance
- bars and phrases
- semantic-embedding use
- component confidence
- explicit ranking metrics and reasons
- master QC and warnings

This review surface is intentionally upstream of expensive image/video generation.

## Canonical cache and queue

`public.track_music_intelligence` stores one canonical analysis per `tracks.id`, plus exact-master provenance columns.

A v3 result can arrive from either Video Director or a release-linked Vault entry. Both converge into the same canonical row only when they refer to the current master.

Worker contention is not an error. Video jobs remain `planned`; Vault analyses remain `queued`; Atlas dispatches the oldest eligible job and keeps Sandbox concurrency at one.

## Storyboard and rendering

The Creative Director owns visual narrative. Deterministic timing alignment then uses Track Intelligence:

- verified model downbeats may be used for precise musical snapping
- inferred grids are treated as lower-confidence timing
- structural edit points remain useful even without verified downbeats
- minimum-shot guards prevent micro-cuts

`hook_15` and `promo_30` use the duration-specific primary social cut first, then ranked candidates, with legacy energy fallback only for older maps.

The original Atlas master remains the final render audio source.

## Quality calibration

A strong MIR system still needs artist-specific evaluation. Atlas therefore treats Track Intelligence quality as a measurable product surface rather than something declared "perfect" by code review.

The benchmark corpus should contain representative Atlas tracks with human labels for:

- BPM
- meaningful section boundaries
- preferred windows per production intent
- preferred 6s / 8s / 15s / 30s cuts
- known master-QC conditions when relevant

Track improvements should be evaluated on boundary error, BPM error, top-1 / top-3 preferred-window recall and artist preference, not just whether the worker returned JSON.

The CI synthetic-audio test protects deterministic v3 behavior. A private real-track benchmark remains the gate for tuning ranking weights against Atlas's actual catalog.

See `services/media-worker/README.md` for runtime details and `docs/track-intelligence-benchmark.md` for the calibration workflow.
