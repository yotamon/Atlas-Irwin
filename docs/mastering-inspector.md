# Ensemblis Mastering Inspector

**Status:** v1 implementation  
**Surface:** Music → Track → Mastering  
**Source of truth:** the exact canonical master used by Audio Intelligence

## Product goal

Mastering Inspector answers three artist questions before distribution:

1. Is there a technical defect that should be fixed before release?
2. Is there a platform/codec risk or unusual mastering behavior worth reviewing?
3. Where in the track should the artist listen to verify the finding?

It is deliberately not an automatic mastering service and does not invent a single universal mastering target. A loud, dark, wide or compressed master is not wrong merely because it differs from a generic preset.

Artist-facing judgments are separated into:

- **Technical defect** — clipping, invalid delivery shape, severe phase/mono problems, suspicious silence/DC conditions.
- **Platform risk** — true-peak/codec headroom and playback-normalization implications.
- **Reference deviation** — differences from the artist's own catalog/reference profile.
- **Creative observation** — dynamics, tonal, stereo and tempo behavior worth auditioning but not intrinsically defective.

The top-level state is qualitative:

- `ready`
- `ready_review_suggested`
- `fix_before_release`

There is no pseudo-precise mastering quality score.

## Measurement stack

### Canonical loudness / true peak

FFmpeg's `ebur128` analyzer is the canonical measurement engine. It provides an ITU-R BS.1770 / EBU R128-oriented measurement path for:

- Momentary loudness;
- Short-Term loudness;
- Integrated loudness;
- Loudness Range;
- true-peak measurement;
- a time series that can be aligned with the musical timeline.

`pyloudnorm` is a second independent implementation used as a cross-check rather than a replacement source of truth.

### Sample / delivery QA

SoundFile + NumPy provide:

- container/subtype where available;
- sample rate, channels and bit depth for PCM sources;
- sample peak and peak location/channel;
- digital clipping sample count;
- near-full-scale / potential flat-top runs;
- RMS / crest factor;
- DC offset;
- leading/trailing silence.

### Dynamics

The inspector exposes:

- LRA;
- PLR (true peak minus Integrated LUFS);
- PSR distribution when frame-level R128 data is available;
- 3-second RMS distribution and relative dynamic spread;
- crest factor.

These are descriptive signals. Ensemblis does not impose one dynamics target on every genre or artist.

## Stereo and mono compatibility

The inspector measures:

- overall L/R correlation;
- Mid/Side RMS relationship;
- mono fold-down level change;
- localized 4-second mono-loss windows;
- Side-energy share in sub/bass/low-mid/mid/presence/air bands.

Localized issues retain timestamps so the artist can audition the relevant window directly.

## Tonal balance and references

The canonical analysis stores a compact `reference_signature` containing:

- loudness/peak/dynamics measures;
- band-relative spectral energy;
- stereo metrics;
- beat-stability summary.

The default product compares the current master against the median of the artist's other analyzed Ensemblis masters. The comparison is descriptive and artist-specific. Tonal deviation alone never creates a technical failure.

The same signature contract can support one-off uploaded reference masters later without changing the Mastering Inspector schema.

## Codec stress test

The worker produces temporary lossy transcodes when the bundled FFmpeg build supports them:

- AAC 256 kbps;
- Opus 160 kbps;
- Vorbis quality 5.

Each temporary encoded file is analyzed again with EBU R128. The result records reconstructed true peak, loudness delta and source-to-codec true-peak delta. Temporary files are deleted after analysis.

This is deliberately called a **codec stress test**, not an exact Spotify/Apple simulation. Provider encoders and playback chains may differ.

## Spotify playback preview

The inspector includes a versioned playback-normalization preview using the current Spotify artist guidance profile persisted in code. It shows the estimated gain for Loud / Normal / Quiet playback and an estimated post-gain true peak.

A master is never marked wrong simply because it is not -14 LUFS. The preview exists to explain playback normalization and true-peak headroom consequences.

## Beat Stability

Beat Stability is part of the same master analysis because AI-generated music can contain tempo drift even when a single global BPM estimate looks plausible.

### Why a single BPM is insufficient

A track may have a global estimate of `120 BPM` while locally moving through values such as `120 → 119 → 117 BPM`. This can create DJ-grid, edit, loop and synchronization problems even though an ordinary BPM label looks correct.

### Canonical algorithm

Beat Stability starts from the canonical beat timestamps already produced by Audio Intelligence. It does not create a competing master clock.

1. Sort and deduplicate canonical beat timestamps.
2. Convert consecutive inter-beat intervals into instantaneous BPM.
3. Normalize obvious half-time/double-time tracker aliases around the canonical BPM.
4. Compute robust local tempo using an 8-beat median window.
5. Apply a small median smoother so tracker jitter is not mistaken for musical drift.
6. Measure:
   - median BPM;
   - 5th/95th percentile BPM;
   - central 90% BPM span;
   - median absolute deviation;
   - local tempo jitter;
   - fraction of locally stable windows;
   - linear BPM slope and estimated end-to-end drift;
   - abrupt local BPM changes.
7. Compare changes against canonical section boundaries.
8. Compute stable section-local tempo and adjacent section tempo steps.

### Classifications

- **`stable`** — local tempo remains tightly clustered around the median.
- **`drifting`** — a gradual tempo slope is visible across the track.
- **`unstable`** — non-section-aligned jumps/jitter or a material tempo span is detected.
- **`section_tempo_changes`** — clean tempo changes align with musical sections and are surfaced as an informational creative choice rather than a defect.
- **`unknown`** — insufficient trustworthy beat evidence.

This distinction is important: intentional tempo automation must not be presented as a mastering failure.

### Beat This shadow validation

When the optional MIT-licensed Beat This provider is enabled in the advanced worker profile, its beats/downbeats remain a shadow cross-check. Agreement/error metadata is attached to Beat Stability, but Beat This does not silently replace the canonical rhythm grid until it improves the private catalog benchmark.

## Data contract

`mastering_inspector` is embedded in the canonical Audio Intelligence v4 result:

```text
mastering_inspector
├─ status / technical_ready
├─ measurement_engine
├─ format
├─ loudness + timeline
├─ loudness_crosscheck
├─ peaks
├─ dynamics
├─ stereo + stereo_timeline
├─ tonal_balance
├─ beat_stability
├─ codec_stress
├─ platform_previews
├─ reference_signature
└─ issues
```

For compatibility, `master_qc` continues to exist and is backfilled from the canonical Mastering Inspector measurements. Existing consumers therefore do not lose technical readiness, loudness or peak data.

## UX contract

The default Track workspace gets a first-class **Mastering** section. It prioritizes:

- Ready / Review suggested / Fix before release;
- six immediately useful metering values;
- evidence-backed issues with listen-at-timestamp controls;
- Beat Stability with a local-tempo graph;
- Spotify normalization preview;
- delivery/file QA;
- codec stress results;
- artist-catalog mastering comparison.

Provider/model internals stay out of the normal artist path.

## Safety and interpretation rules

- No LLM decides whether a measurement passes.
- Technical and platform rules operate on deterministic measurements.
- Reference/creative differences do not become defects without explicit evidence.
- No generic tonal-balance percentage threshold is treated as objective mastering truth.
- Codec preview never claims to reproduce a proprietary streaming encoder exactly.
- Beat instability is not inferred from one global BPM number.
- Section-aligned tempo changes are distinguished from unintentional drift.
- Legacy `master_qc` compatibility remains intact during rollout.
