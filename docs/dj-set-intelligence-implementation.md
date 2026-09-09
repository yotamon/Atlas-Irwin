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

The Studio and worker use a source-neutral Set Intent contract with:

- duration and purpose inherited from the AutoMix job;
- `allow_omissions`;
- must-play track IDs;
- blocked track IDs;
- optional BPM range;
- optional target track count.

The Studio now treats the selected catalog tracks as a **candidate pool**. For normal DJ modes the user can let Ensemblis curate that pool for the requested duration, keep every candidate, set a target track count, bound the BPM range and mark individual tracks as must-play. `journey` is deliberately different: it preserves every selected track and the supplied order.

The API validates and snapshots Set Intent into `automix_jobs.request_payload`, includes it in idempotency, and forwards the same normalized contract to the worker.

## Personal DJ Intelligence v1

`dj_profiles` stores artist-scoped explicit preferences plus a separately inspectable learned layer. Explicit settings are authoritative. Learned evidence is capped before it reaches the worker and cannot override hard audio-quality constraints.

Current effective dimensions are deliberately limited to signals that actually affect planning:

- harmonic adventure;
- transition aggressiveness;
- exploration.

The Studio exposes these controls in `DJ & Mixes`. Users can also rate the latest completed verified plan. Positive ratings contribute bounded evidence; negative ratings are stored without guessing what the user disliked.

## Candidate curation and duration correctness

Set Intelligence may remove weaker candidates before the canonical planner runs. Candidate selection considers musical-identity window quality, source-master quality, requested energy territory, harmonic/tempo coherence and the bounded personal DJ profile.

After curation, Ensemblis **recomputes showcase-window duration from the final selected track count**. This prevents a short candidate-pool window from leaking into the final plan when, for example, ten source tracks are curated down to four.

Must-play tracks survive duration curation. Hard conflicts such as a must-play track outside an explicit BPM range fail visibly instead of being silently ignored.

## Source-neutral boundary

`lib/automix/source-contract.ts` defines `ensemblis.automix-source.v1` and the adapter boundary that future source integrations must implement. The current artist catalog is the first source kind. Later integrations may add `local_library`, `rekordbox`, `serato` and `traktor` without changing Set Intelligence or MixPlan semantics.

The contract explicitly separates source kind from execution target. Today catalog audio is cloud-readable and renders in the cloud. A future local-library source can use the same planner contract while declaring `executionTarget: "device"`.

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

The next work stays on top of the same contracts:

1. interactive lock/replace/reorder operations against an existing verified plan;
2. transition-only previews without rerendering the whole set;
3. plan alternatives (`safe`, `recommended`, `adventurous`);
4. stable source adapters, beginning with the current catalog contract and then Rekordbox read/import;
5. only after the source contract is proven, the Windows/macOS Library Bridge and device execution plane;
6. Serato and Traktor adapters behind the same boundary.

No later phase should create a second DJ planner or bypass MixPlan v2.
