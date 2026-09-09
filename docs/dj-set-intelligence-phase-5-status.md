# DJ Set Intelligence Phase 5 Status

**Phase:** Production hardening and scale  
**Status:** Implementation in validation  
**Baseline:** Phase 4 / `ensemblis.dj-profile.v2`

## Audit result

Most roadmap requirements were already delivered by earlier AutoMix and Set Builder work. Phase 5 therefore hardens the real remaining failure and observability boundaries instead of introducing parallel infrastructure.

Already present before this phase:

- durable AutoMix jobs and queue idempotency;
- deterministic MixPlan v2 with planner version and plan hash;
- source fingerprints and canonical-master validation;
- exact approved-plan rendering without replanning;
- preview reuse with source-lineage validation;
- transition fallbacks and graceful optional-intelligence degradation;
- private/audio regression coverage;
- output asset lineage containing source fingerprints, engine metadata, quality contract and approved MixPlan hash.

## Added in Phase 5

### Exact approved-render retry

A failed operational render can create a new durable render attempt from the exact frozen `approved_mixplan`.

The retry:

- never mutates the failed attempt;
- never invokes the planner;
- keeps the exact plan hash and source windows;
- validates canonical source URLs again before queueing;
- refuses retry when the approved source lineage is stale;
- creates explicit `retry_of_job_id` lineage;
- remains idempotent for repeated retry clicks against one failed attempt.

Cancelled/stale jobs are intentionally not retryable because their source validity is no longer guaranteed.

### Renderer compatibility contract

New MixPlans declare:

`ensemblis.offline-audio-render.v1`

Unknown explicit render-engine contracts fail closed. Historical MixPlan v2 manifests created before this field existed remain accepted as the original renderer contract so previously approved plans stay reproducible.

### Execution metrics

AutoMix returns versioned execution metrics including:

- source preparation / planning / render wall time;
- rendered output duration;
- realtime factor;
- source-track count;
- output byte count.

These are operational cost/runtime proxies and do not alter planner or DSP behavior.

### Mix-level QA diagnostics

Each completed worker result emits a versioned QA summary with:

- plan hash;
- transition count;
- low-confidence transition count;
- total risk flags;
- warning count;
- maximum absolute playback stretch delta;
- source fingerprint count;
- quality summary;
- final output duration/loudness/ceiling evidence when rendered.

### Studio recovery UX

A recovery control appears only when the latest approved-render attempt failed. It queues an exact-plan retry and disappears when a newer render attempt becomes authoritative.

## Safety invariants

Production recovery must never become a bypass around musical or lineage safety. A retry cannot change order, track windows, transition automation, output source identities or the MixPlan hash. If a canonical master changed, the user must build a new verified plan.

## Validation gate

Phase 5 is complete only when the final PR head passes Studio contracts, typecheck, lint, browser smoke, Media Worker regressions, applicable database checks, review-thread audit and the post-merge production build on `main`.
