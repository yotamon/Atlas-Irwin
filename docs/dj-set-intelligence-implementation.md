# DJ & Mixes Set Intelligence implementation

Status: implemented on the `feat/automix-set-intelligence-complete` development line.

## Product boundary

Ensemblis remains the intelligence and preparation layer above DJ software, not a replacement for Rekordbox, Serato or Traktor. The web product owns music understanding, candidate curation, set planning, transition intelligence, explainability and AutoMix rendering. External DJ-library adapters remain a later source concern.

## Runtime flow

```text
Artist catalog candidate pool
        ↓
Music / Mastering / Stem Intelligence
        ↓
Set Intent v1
        ↓
Duration-aware candidate curation
        ↓
Personal DJ profile (bounded)
        ↓
Canonical AutoMix planner
        ↓
Verified MixPlan v2 + planning provenance
        ↓
Canonical AutoMix renderer
        ↓
Rendered / measured mix asset
```

The canonical AutoMix planner and renderer remain the only authorities for transition safety, tempo reliability, phrase boundaries, stretch limits, vocal/bass collision protection, fallback techniques and final rendering.

## Set Intent v1

The worker accepts a source-neutral Set Intent contract with:

- duration and purpose inherited from the AutoMix job;
- `allow_omissions`;
- must-play track IDs;
- blocked track IDs;
- optional BPM range;
- optional target track count.

Current Studio sessions default to duration-aware curation except `journey`, which preserves the supplied candidate pool unless an explicit future control says otherwise.

## Personal DJ Intelligence v1

`dj_profiles` stores artist-scoped explicit preferences plus a separately inspectable learned layer. Explicit settings are authoritative. Learned evidence is capped before it reaches the worker and cannot override hard audio-quality constraints.

Current dimensions:

- harmonic adventure;
- transition aggressiveness;
- exploration;
- opening energy;
- closing energy.

The Studio exposes these controls in `DJ & Mixes`. Users can also rate the latest completed verified plan. Positive ratings contribute bounded evidence; negative ratings are stored without guessing what the user disliked.

## Reproducibility

The DJ profile used by a queued session is snapshotted into the worker payload. Set Intent, selection summary, omitted candidates, applied DJ profile and requested/effective transition style are copied into the MixPlan manifest and included in its canonical hash.

This keeps an old mix explainable even after the user's profile or the planner evolves.

## Safety invariants

Personalization may influence candidate selection and may reinterpret only the neutral `dj` transition style into a more restrained or creative preference. It does not bypass:

- ±6% playback-rate contract;
- variable-tempo safeguards;
- transition-boundary confidence;
- vocal/bass collision vetoes;
- master-quality handling;
- MixPlan validation;
- final loudness and true-peak checks.

## Next product phases

The next meaningful work is not another parallel engine. It is deeper Set Builder editing on top of the same plan contract: lock/replace/reorder operations, transition previews, plan alternatives and explicit must-play/blocked controls in the workspace. External Rekordbox/Serato/Traktor sources should be added only after those plan operations are stable.
