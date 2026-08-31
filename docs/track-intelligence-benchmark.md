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

For each track, listen without looking at Atlas predictions first and record:

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

Run:

```bash
node scripts/evaluate-track-intelligence.mjs /private/path/benchmark.json
```

The evaluator reports:

- BPM mean absolute error
- median nearest-section-boundary error
- production-moment top-1 and top-3 recall
- social-cut top-1 and top-3 recall
- per-track misses

A preferred window matches when the predicted and annotated windows overlap strongly enough to represent the same usable musical moment. Top-3 recall is the primary ranking metric because Atlas exposes alternatives and the artist can make the final creative choice.

## Tuning protocol

When changing ranking weights or features:

1. Freeze the annotations before looking at new predictions.
2. Run the old analyzer and save its benchmark output.
3. Run the candidate analyzer on the same masters.
4. Compare aggregate metrics and inspect every regression.
5. Listen blind to changed top candidates on at least the regressed tracks.
6. Merge only when aggregate quality improves without a serious genre-specific regression.

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

The long-term quality target is not merely high recall. It is **a high probability that at least one of Atlas's first three suggestions is immediately production-usable**.

## CI vs private benchmark

CI uses a generated synthetic master to protect deterministic code paths, fallback rhythm provenance, scoring shape, social alternatives and QC. It deliberately does not download model weights or private music.

The private Atlas corpus is the calibration gate for musical quality. Keep the manifest, analysis outputs and unreleased masters outside the public repository.
