# Track Intelligence calibration benchmark

Track Intelligence should improve against real Atlas music, not against intuition or a single demo track. This benchmark is intentionally private-data friendly: unreleased audio and annotations do not belong in the public repository.

## Corpus

Start with 12–20 representative Atlas masters spanning:

- nu-disco / disco-house
- electro-funk
- slower neo-soul / groove material
- tracks with long intros or DJ-friendly arrangements
- tracks with obvious drops
- tracks whose best marketing hook is **not** the loudest chorus
- repetitive harmonic tracks where semantic recurrence matters
- difficult masters with sparse percussion or ambiguous downbeats

Do not select only tracks on which the current model already looks good.

## Human annotation

For each track, listen without looking at Ensemblis predictions first and record:

- expected BPM
- musically meaningful section boundaries
- acceptable windows for each production intent:
  - instant hook
  - musical identity
  - groove loop
  - build/drop
  - climax
  - story arc
- acceptable 6s / 8s / 15s / 30s social windows
- for semantic-provider evaluation, a small set of human-approved descriptors for the strongest musical moments

Multiple acceptable windows are encouraged. Music rarely has one objectively correct timestamp.

A benchmark fixture points at a previously generated Track Intelligence JSON file:

```json
{
  "thresholds": {
    "max_bpm_mae": 1.5,
    "max_section_boundary_median_ms": 1800,
    "min_moment_top3_recall": 0.8,
    "min_social_top3_recall": 0.8
  },
  "tracks": [
    {
      "id": "atlas-track-01",
      "analysis": "analyses/atlas-track-01.json",
      "expected_bpm": 122,
      "section_boundaries_ms": [12500, 43800, 75200],
      "preferred_windows": {
        "instant_hook": [
          { "start_ms": 74200, "end_ms": 82400 }
        ],
        "musical_identity": [
          { "start_ms": 75200, "end_ms": 90200 },
          { "start_ms": 138000, "end_ms": 153000 }
        ]
      },
      "preferred_social_cuts": {
        "15": [
          { "start_ms": 75200, "end_ms": 90200 }
        ],
        "30": [
          { "start_ms": 62000, "end_ms": 92000 }
        ]
      }
    }
  ]
}
```

Run the product-specific evaluator:

```bash
node scripts/evaluate-track-intelligence.mjs /private/path/benchmark.json
```

The evaluator reports:

- BPM mean absolute error
- median nearest-section-boundary error
- production-moment top-1 and top-3 recall
- social-cut top-1 and top-3 recall
- per-track misses

A preferred window matches when the predicted and annotated windows overlap strongly enough to represent the same usable musical moment. Top-3 recall is the primary ranking metric because Ensemblis exposes alternatives and the artist can make the final creative choice.

## Standards-based MIR evaluation

The optional benchmark profile adds `mir_eval` without putting it in the production worker:

```bash
cd services/media-worker
python -m pip install -r requirements-audio-benchmark.txt
python benchmarks/evaluate_mir.py \
  /private/path/annotation.json \
  /private/path/analysis.json
```

The annotation file may contain:

```json
{
  "bpm": 122,
  "beats_ms": [0, 492, 984],
  "downbeats_ms": [0, 1968],
  "section_intervals_s": [[0, 16.1], [16.1, 32.2]]
}
```

This produces standards-based beat/downbeat F-measure, 500 ms section-boundary precision/recall/F-measure, and BPM error where annotations are available. These metrics complement the Ensemblis-specific moment and social-cut preference metrics rather than replacing them.

## Robustness and invariance corpus

A production analyzer should preserve musical identity when the same master arrives through a harmlessly different export. The optional Audiomentations corpus generator creates deterministic, time-and-pitch-preserving variants:

```bash
cd services/media-worker
python benchmarks/generate_robustness_corpus.py \
  /private/path/master.wav \
  /private/path/robustness/track-01
```

The generated corpus currently covers fixed gain change, low-level noise, a 35 Hz high-pass, and a 16 kHz low-pass. It deliberately avoids pitch/time transformations because those change the musical evidence under test.

Analyze the original and each generated variant with the same Ensemblis configuration, then compare JSON outputs:

```bash
python benchmarks/robustness_metrics.py \
  /private/path/baseline.json \
  /private/path/variant-gain.json \
  /private/path/variant-noise.json
```

Initial invariance gates are:

| Metric | Initial gate |
| --- | ---: |
| BPM relative error | <= 1% |
| Median section-boundary drift | <= 650 ms |
| Top-3 moment temporal recall | >= 80% |
| CLAP top-3 descriptor overlap, when semantic evidence exists | >= 66% |

A missing optional semantic result does not fail deterministic MIR robustness. Semantic stability is evaluated only when the same CLAP provider/model/revision ran on both analyses.

## Optional provider promotion policy

Optional providers remain evidence until the private corpus proves that they improve product outcomes.

### Beat This

Beat This stays in `shadow` mode. Compare it with the canonical rhythm grid on the private corpus using beat/downbeat metrics plus edit-point listening tests. Do not promote it merely because it is newer or wins a public benchmark.

### Basic Pitch

Basic Pitch is stem-only and optional. Evaluate note/melody intelligence on tonal stems, focusing on whether contour, range, climax and repeated-motif summaries are useful and stable enough to support creative decisions. Do not run it on drums, percussion or FX stems.

### CLAP

CLAP is additive cross-modal evidence. It must never replace All-In-One/librosa structure or the canonical musical timeline. The production profile pins both model ID and revision, disables model downloads by default, and records provenance on every semantic result.

Before enabling CLAP for a production worker profile, evaluate:

- descriptor usefulness on artist-labeled moments
- descriptor stability across the robustness corpus
- cross-track retrieval quality on a held-out catalog subset
- latency and memory cost for the intended worker class
- failure behavior with a missing local model cache

Only after retrieval quality is demonstrated should Ensemblis add a persistent vector index such as pgvector. Raw vectors in Track Intelligence are currently evidence and future-indexing material, not a reason to introduce a second canonical store prematurely.

## Tuning protocol

When changing ranking weights, models or features:

1. Freeze the annotations before looking at new predictions.
2. Run the old analyzer and save its benchmark output.
3. Run the candidate analyzer on the same masters.
4. Compare aggregate metrics and inspect every regression.
5. Run the identity-preserving robustness corpus.
6. Listen blind to changed top candidates on at least the regressed tracks.
7. Merge only when aggregate quality improves without a serious genre-specific regression.

Never tune weights to one track and call the system improved.

## Suggested initial gates

These are starting targets, not universal truths:

| Metric | Initial gate |
| --- | ---: |
| BPM MAE | <= 1.5 BPM |
| Median section boundary error | <= 1.8 s |
| Moment top-3 recall | >= 80% |
| Social top-3 recall | >= 80% |

Once the corpus grows, tighten gates based on the best stable baseline.

## Artist preference test

Numerical labels do not fully capture "this is the part I would actually post." For major ranking changes, export paired anonymous candidates from baseline and candidate builds and choose A/B without seeing which algorithm produced each one.

Track:

- overall preference
- preference by intent
- preference by track style
- cases where neither candidate is acceptable

The long-term quality target is not merely high recall. It is **a high probability that at least one of Ensemblis's first three suggestions is immediately production-usable**.

## CI vs private benchmark

CI uses generated/synthetic inputs to protect deterministic code paths, fallback rhythm provenance, scoring shape, semantic fail-soft behavior, melodic summaries, social alternatives, mastering diagnostics and robustness-metric logic. It deliberately does not download model weights or private music.

The private Atlas corpus is the calibration gate for musical quality. Keep the manifest, analysis outputs and unreleased masters outside the public repository.
