# Personal DJ Intelligence v2

## Goal

Turn deliberate Set Builder decisions into bounded, inspectable evidence that can improve future planning without weakening deterministic musical safety.

## Learning inputs

The profile can learn from completed, verified decisions:

- whole-plan feedback;
- reorder + lock;
- replace track;
- exclude track;
- transition override;
- transition reset;
- approved exact-plan render.

Rejected whole-plan feedback is retained as inspectable evidence but is not inverted into guessed preferences.

## Profile dimensions

`ensemblis.dj-profile.v2` carries:

- harmonic adventure;
- transition aggressiveness;
- exploration;
- tempo movement;
- energy dynamics.

Explicit preferences remain authoritative. Accepted evidence is aggregated with bounded weights and learned confidence remains capped at `0.6`. The final planner nudge is additionally bounded and cannot override hard constraints.

## Safety invariants

Personalization only reranks otherwise valid candidates. It cannot override:

- stretch limits;
- canonical-master lineage;
- BPM/tempo reliability constraints;
- vocal or bass collision vetoes;
- transition validation and fallbacks;
- hard Set Intent constraints;
- user locks.

## Evidence lifecycle

```text
Set Builder decision
        ↓
new durable plan revision
        ↓
worker verifies plan + source lineage
        ↓
revision reaches completed state
        ↓
structured weighted evidence
        ↓
profile recalculation
        ↓
next queued plan snapshots profile v2
        ↓
bounded candidate reranking
```

Learning is deliberately non-blocking. A temporary profile aggregation failure must never invalidate a valid plan or rendered/cataloged output.

## Idempotency

Evidence identity is:

```text
owner_id + artist_id + automix_job_id + evidence_type + evidence_key
```

This allows multiple distinct decisions for one completed revision while making retries of the same event safe.

## Movement signals

Tempo movement uses adjacent relative BPM movement.

Energy dynamics uses adjacent absolute deltas because track energy is already normalized to a `0..1` scale. Relative ratios would overstate differences around low-energy values.
