# Durable background execution production verification — 2026-10-01

**Readiness workstream:** Task 2  
**Implementation PR:** #269  
**Merged SHA:** `fd598a3e39810fd0f514c79ad26c241397166720`  
**Production deployment:** `dpl_3nBpaecK3gxgE6UZzbN8tCW2prAY`

## Release evidence

The merged SHA passed the repository and production delivery gates:

- PR Studio product contracts: 542/542 passed.
- PR TypeScript: passed.
- PR ESLint: passed.
- PR browser smoke: passed.
- PR Audio Intelligence CI: passed.
- Main-branch CI after merge: passed, including the real production build.
- Main-branch browser smoke after merge: passed.
- Main-branch Audio Intelligence CI after merge: passed.
- Vercel production deployment for the exact merged SHA reached `READY` and owns the production aliases.
- Supabase migration history remained exactly canonical at 150 local / 150 production migrations.

## Controlled heartbeat verification

Two authenticated production heartbeat requests were triggered through the existing Supabase Vault credential without exposing the raw token.

Both requests returned:

- HTTP 200;
- `ok: true`;
- `accepted: true`;
- mode `durable-post-response-heartbeat`;
- auth source `supabase_vault`;
- no pg_net timeout.

### First heartbeat

Before the heartbeat there were zero `maintenance:%` rows.

The first heartbeat created exactly ten stable recurring maintenance rows for the one active production Artist and processed the immediately due maintenance work.

The 15-minute maintenance rows advanced to their next cadence:

- `maintenance:state_reconciliation`;
- `maintenance:publications`;
- `maintenance:outreach`;
- `maintenance:creative_spend`;
- `maintenance:creative_derivatives`;
- `maintenance:event_automation`.

### Second heartbeat

A second heartbeat was intentionally triggered after the initially staggered long-cadence jobs became due.

Verification showed:

- maintenance row count remained exactly **10**, proving idempotent seeding;
- `maintenance:audience_sync` advanced to its next hourly cadence;
- `maintenance:next_best_actions` advanced to its next hourly cadence;
- `maintenance:manager_execution` advanced to its next hourly cadence;
- `maintenance:radar` advanced to its next six-hour cadence;
- all ten rows were back in `queued` state;
- all ten rows had `attempt_count = 0`;
- no row remained locked;
- no row carried a failure message.

## Runtime evidence

Vercel Runtime Errors for the deployment window returned no runtime error clusters.

The implementation also makes the runtime contract explicit:

- `vercel.json`: Fluid Compute enabled;
- Marketing route `maxDuration = 300`;
- durable heartbeat internal budget: 180 seconds;
- new-job headroom: 90 seconds;
- persistent jobs remain the correctness/recovery mechanism if an invocation ends early.

## Capacity semantics

The shared Media Worker now classifies provider dispatch failures as:

- busy;
- transient capacity/quota;
- stale/gone Sandbox;
- fatal.

A transient Sandbox capacity response returns durable work to a pending state with a persisted retry marker rather than terminally failing it. Shared-worker arbitration stops sibling queue probes after a started/busy/capacity result.

This contract covers:

- Music / Video / Stem worker jobs;
- Active Mastering;
- Mastering Reference analysis;
- AutoMix;
- AutoMix transition previews;
- Marketing media finishing.

Content Factory checks quota and actual pending work before creating/resuming Sandbox, and capacity exhaustion becomes a normal deferred result instead of routine HTTP 500.

## Acceptance result

Task 2 implementation and initial production verification are complete.

Longer-term error-rate/queue-age alerting and soak visibility belong to the observability/SLO workstream (Task 7) rather than keeping this implementation task open.
