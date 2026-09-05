# Ensemblis Audio Intelligence V4

Audio Intelligence V4 turns Track Intelligence, Stem Intelligence, Lyrics Intelligence and the Creative Music Graph into one evidence-driven decision system. The goal is not to expose more analysis numbers. The goal is for the first few suggestions to be musically complete, explainable and immediately useful for production.

## Product contract

V4 must answer, from the exact canonical master:

- What are the complete musical phrases and sections worth presenting to an audience?
- Which five moments best represent distinct useful production intents?
- Where can a social edit start and end without cutting through a musical phrase?
- How confident are rhythm, boundaries and structure, and which analyzer produced each piece of evidence?
- What do synchronized stems add to the interpretation of entries, exits, builds, releases and hooks?
- When official lyrics exist, can lyric timing strengthen a creative decision without overriding manual timing or inventing words?
- Are there mix/master conditions worth reviewing before expensive creative generation?
- Can heavyweight or experimental analyzers be evaluated without making the default worker fragile or expensive?

## Runtime architecture

```text
canonical master
  -> Track Intelligence V3 deterministic baseline
  -> Track Intelligence V4 musical-unit post-processing
       -> complete phrase / phrase-pair / section candidates
       -> boundary confidence + explainable evidence
       -> diversity-constrained top five Musical Moments
       -> 6s / 8s / 15s / 30s cuts derived from those moments
       -> rhythm consensus + optional Beat This shadow comparison
       -> descriptive Mix Intelligence
       -> atlas.musical_timeline.v1

synchronized stems
  -> Stem Intelligence V2 baseline
  -> Stem Intelligence V3
       -> activity timeline
       -> entry / exit / lift / release evidence
       -> optional Basic Pitch note intelligence for tonal stems

known official lyrics
  -> existing immutable-text Lyrics Intelligence
  -> monotonic section alignment
  -> vocal-activity line alignment where a vocal stem exists
  -> manual timing always wins

Track + Lyrics + Stems + Audio Scenes
  -> Creative Graph V2
       -> multimodal clustering
       -> complete V4 Musical Moment remains the timing anchor
       -> downstream campaign/video context
```

The old analyzers remain importable. `app.runner` switches production Sandbox jobs to the V4/V3 wrappers, which keeps rollback small and explicit.

## Musical Moments V2

V3 ranked fixed-duration candidate windows. V4 first constructs legal musical units:

1. detected/inferred phrases;
2. adjacent phrase pairs inside the same section;
3. complete sections when they are a usable duration;
4. only when no reliable phrase grid exists, a compatibility fallback to legacy windows.

Each unit inherits the rich V3 evidence that overlaps it and adds:

- `musical_completeness`;
- `boundary_confidence`;
- boundary provenance;
- production-intent scores;
- explainable reasons;
- original candidate evidence.

The artist-facing candidate list is deliberately capped at five and selected with overlap, intent and section diversity constraints. The system must not pad a weak analysis with filler.

`hook_candidates_v3` retains the original V3 candidate set for debugging and benchmark comparison. `hook_candidates` and `musical_moments` are the V4 complete moments.

## Social cuts are derived products

A Musical Moment is not a 6, 8, 15 or 30 second social asset. V4 therefore derives social cuts only after the complete parent Moment is selected.

A preferred cut edge must be a known musical boundary from a phrase, section, bar or downbeat. Each generated cut stores:

- `source_moment_id`;
- `target_duration_ms`;
- `musical_boundary_constrained`;
- the parent intent/score.

If no appropriate boundary pair exists, the legacy V3 social cut can be retained as an explicit `legacy_fallback`; it is never presented as though it came from V4 boundary reasoning.

## Unified musical timeline

`atlas.musical_timeline.v1` is the canonical audio-coordinate layer. Events carry:

- `start_ms` / `end_ms`;
- confidence;
- analyzer and analyzer version;
- label and kind;
- evidence/provenance.

The timeline currently contains canonical structure, phrases and V4 Musical Moments plus the verified rhythm grid. Lyrics, stems and Audio Scenes remain separate source-of-truth records and are fused in Creative Graph V2 rather than copied into Track Intelligence with fake provenance.

This division is intentional:

- Track Intelligence owns what can be derived from the master.
- Stem Intelligence owns per-layer evidence.
- Lyrics Intelligence owns official text and lyric timing.
- Creative Graph owns cross-modal creative fusion.

## Lyrics timing safety

The official lyrics remain immutable textual truth. Existing Lyrics Intelligence already performs:

- global monotonic section-to-music alignment;
- vocal-stem activity evidence when available;
- line timing biased toward acoustically active singing rather than uniform interpolation;
- exact-excerpt checks for lyric moments;
- manual timing preservation.

V4 does not pretend vocal-activity timing is phoneme recognition. A future singing-specific forced aligner is represented as an external adapter boundary and may only upgrade timing provenance when it returns valid evidence. Manual timing continues to win.

Creative Graph V2 prevents cross-modal averaging from moving a strong lyric/stem/scene cluster away from a complete V4 musical phrase when overlap evidence supports that phrase.

## Stem Intelligence V3

Stem Intelligence V3 wraps the stable V2 analyzer and adds arrangement events:

- `entry`;
- `exit`;
- `lift`;
- section-level `section_lift` / `section_release`.

These are derived from the synchronized activity curve and Track Intelligence section grid. They provide explicit evidence for builds, drops, breakdowns, sparse sections and instrumentation changes without inventing another master clock.

Optional note intelligence is restricted to tonal/non-percussive stems. It is never required to analyze a release.

## Rhythm consensus and Beat This

All-In-One remains the canonical structure/rhythm engine. Librosa remains a documented fallback.

V4 adds two confidence checks:

1. canonical downbeats versus the internal beat-derived four-beat grid;
2. optional Beat This shadow inference.

Beat This is never promoted automatically. When enabled, V4 records median beat/downbeat error and agreement against the canonical analysis. Promotion requires improvement on the private representative-catalog benchmark.

Environment variables for an advanced worker profile:

- `ATLAS_BEAT_THIS_ENABLED=true`
- `ATLAS_BEAT_THIS_MODEL=small0` (default)
- `ATLAS_BEAT_THIS_DEVICE=cpu` (default)

The optional dependency profile is `services/media-worker/requirements-audio-advanced.txt`; it is intentionally separate from the default Vercel Sandbox requirements.

## Music embeddings policy

The current commercial canonical semantic representation remains the embeddings already produced by All-In-One.

MERT is not installed in the production path. The commonly published `m-a-p/MERT-v1-95M` Hugging Face weights are marked CC-BY-NC-4.0, so the provider registry explicitly blocks those default weights for the commercial Ensemblis runtime. A differently licensed representation model may be benchmarked behind the same conceptual provider boundary later.

No feature should silently download research weights in production.

## Optional Basic Pitch

Basic Pitch can add note events and pitch-class summaries to tonal stems when an external/on-demand worker profile explicitly enables it with `ATLAS_BASIC_PITCH_ENABLED=true`.

It is not a default dependency because the currently published package supports Python through 3.11 while Ensemblis CI/deep validation uses newer Python. Provider failure or absence returns an explicit status and never blocks Stem Intelligence.

## Mix Intelligence

V4 extends the existing master QC rather than replacing it. The additional diagnostics include:

- short-term RMS distribution and relative dynamic spread;
- spectral centroid and 95% rolloff;
- broad-band spectral balance;
- mid/side RMS relationship;
- mono fold-down energy delta;
- conservative review cues for unusually concentrated low-mid or presence energy.

These metrics are descriptive review evidence, not universal mastering targets. Existing clipping/technical-ready behavior remains authoritative for blocking technical faults.

## Analysis tiers

### Fast

Always available and cheap enough to keep the release usable:

- source identity / provenance;
- decode metadata;
- master QC and waveform-ready metadata.

### Deep

Canonical Track Intelligence:

- rhythm and structure;
- semantic recurrence;
- complete Musical Moments;
- social-cut derivation;
- Mix Intelligence;
- optional Beat This shadow comparison when an advanced worker explicitly enables it.

### On demand / external profile

- note transcription;
- alternative representation models;
- singing-specific forced alignment;
- other heavyweight experimental analyzers.

A missing optional provider is a capability state, not an analysis failure.

## Backward compatibility

V4 keeps compatibility fields used by existing Video Director / Studio consumers:

- `hook_candidates` still exists;
- legacy V3 candidates are available as `hook_candidates_v3`;
- runtime enrichment restores `target_duration_ms`, `section_type`, `energy`, `energy_lift`, `repetition`, `melodic_salience` and `rhythmic_activity` aliases on V4 moments;
- `social_cuts` and `social_cut_options` retain their existing shapes while adding provenance fields;
- existing V3 analyzers remain available behind the worker-entrypoint swap.

## Quality gates and benchmark V2

`scripts/evaluate-track-intelligence.mjs` remains backward-compatible and now additionally reports:

- top-five production-usable recall;
- mean musical completeness;
- moment diversity;
- boundary-constrained social-cut ratio.

Recommended initial V4 gates after annotating the private corpus:

```json
{
  "max_bpm_mae": 1.5,
  "max_section_boundary_median_ms": 1800,
  "min_moment_top3_recall": 0.8,
  "min_social_top3_recall": 0.8,
  "min_top5_usable_recall": 0.9,
  "min_musical_completeness": 0.78,
  "min_boundary_constrained_social_ratio": 0.9
}
```

The key product metric is: **does at least one of the first five suggestions represent a moment the artist would genuinely use?**

For major ranking changes, keep blind A/B listening in addition to numeric labels.

## Metamorphic regression suite

Real-track evaluation should also verify invariants:

- +3 dB gain: rhythm/key/structure stable; loudness changes predictably;
- pitch shift preserving duration: rhythm/structure stable; tonal analysis shifts;
- time stretch preserving pitch: tonal identity stable; BPM changes;
- stereo-to-mono fold-down: structure stable; stereo diagnostics change.

These are catalog/private tests because they require representative real masters; CI synthetic tests continue to protect deterministic contracts without committing unreleased audio.

## Rollout

1. Merge the single Audio Intelligence V4 PR after typecheck/lint/Studio contract checks pass.
2. Production Sandbox immediately uses V4 complete Moments and Stem Intelligence V3 because the runner owns the routing switch.
3. Keep Beat This disabled initially.
4. Re-analyze the private benchmark catalog and compare V3/V4.
5. Enable Beat This in shadow mode only on an advanced worker profile and collect agreement/error metrics.
6. Promote an optional provider only after it improves artist preference and benchmark metrics without a genre-specific regression.

Rollback is one worker-entrypoint import change; the stable V3/V2 analyzers remain intact.
