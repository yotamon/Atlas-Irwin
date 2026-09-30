# Durable Background Execution — Production Readiness Task 2

**Parent plan:** `docs/superpowers/plans/2026-10-01-production-readiness-v1.md`  
**Parent tracker:** #263  
**Task:** 2 — Make Marketing and Content Factory execution durable  
**Date:** 2026-10-01

## Constraint from Task 1

Production schema parity is restored and the clean 147-migration replay passes, but the new production migration workflow has not yet been proven end-to-end because the protected GitHub `Production` environment still lacks `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`.

Therefore this task must **not add or deploy a new database migration** until that external credential gate is closed. Use existing durable columns and JSONB payload/result fields.

## Existing durable primitives to reuse

### `automation_jobs`

Already provides:
- owner + artist scope;
- arbitrary text `job_type`;
- JSONB payload/result;
- unique owner-scoped idempotency key;
- queued/running/completed/failed/cancelled states;
- `run_after`;
- `attempt_count` / `max_attempts`;
- `locked_at`;
- database `FOR UPDATE SKIP LOCKED` claiming;
- exponential retry backoff in the application worker.

This is the canonical scheduler/retry ledger for internal Marketing work.

### `generation_runs`

Already provides durable queued/running/completed/failed execution/provenance state and JSONB input/output/metadata. Use it for Content Factory render execution lineage.

### `marketing_media_jobs` and existing media queues

Already provide:
- durable planned/queued/running/terminal state;
- idempotency;
- attempt counters;
- callbacks;
- recovery of stranded dispatch claims.

Do not replace them with a generic second queue.

## Semantic state mapping without a schema migration

Until explicit lease/backoff columns can be materialized later:

- `automation_jobs.status=queued` + future `run_after` = **retry_wait**
- `automation_jobs.status=running` + `locked_at` = **claimed/running**
- `automation_jobs.status=completed` = **dispatch accepted / terminal internal job**
- `automation_jobs.status=failed` = **failed_terminal**
- existing `cancelled` = **canceled**
- media jobs use existing planned/queued/running/terminal states;
- media retry-not-before/error-class metadata is stored in reserved JSONB payload keys until a future migration can materialize fields.

## Workstream A — shared failure classification and retry metadata

Create a pure helper under `lib/platform/` or `lib/media-worker/` that classifies:
- busy/lock contention;
- capacity/quota/rate limit (402/429/quota/hobby/billing/resource);
- gone/recoverable Sandbox identity (410);
- generic transient;
- terminal/invalid request where determinable.

For quota/capacity:
- never tight-loop;
- deterministic exponential backoff, minimum 1 hour, capped at 24 hours;
- expose a stable `errorClass` and `retryAt`;
- do not consume a paid fallback.

Reserved JSONB metadata:
- `__ensemblis_retry_not_before`
- `__ensemblis_last_error_class`
- `__ensemblis_trace_id` already exists where applicable.

Tests must prove deterministic backoff and quota classification.

## Workstream B — Marketing Media Worker capacity-aware retries

Update `lib/marketing/media-worker-queue.ts` so:
- planned jobs whose retry-not-before is in the future are skipped;
- Sandbox busy returns to planned without consuming terminal capacity;
- quota/capacity failure returns to planned with retry-not-before and error class;
- a heartbeat during the backoff window does not call Sandbox again;
- successful dispatch clears retry metadata;
- terminal attempt exhaustion still fails visibly;
- callback-triggered retry follows the same bounded semantics where possible.

No new DB column.

## Workstream C — Content Factory becomes durable + detached

The current Content Factory route synchronously bootstraps ffmpeg and renders inside the request. Replace that architecture.

### Scheduling

`/api/cron/content-factory` must:
1. authenticate;
2. find at most one scheduled content item missing an asset;
3. upsert/recover an idempotent `automation_jobs` row with job type `free_content_factory_render`;
4. attempt only the short dispatch phase;
5. return immediately with queued/dispatched/backoff/degraded state.

It must not wait for:
- npm install;
- ffmpeg render;
- full file download/upload;
- database finalization after render.

### Dispatch

The automation job handler:
- validates artist/owner/content lineage;
- creates or reuses a queued `generation_runs` record for this automation-job attempt;
- mints the output upload credential;
- creates/gets the persistent free-content Sandbox;
- writes a request envelope;
- starts a detached shell/Node runner;
- returns once the detached process is accepted.

The detached runner:
- bootstraps `ffmpeg-static@5.2.0` inside the persistent Sandbox if absent;
- downloads artwork/audio;
- renders the deterministic 15-second asset;
- uploads to the exact signed output URL;
- sends running/completed/failed callback with generation/automation identifiers;
- never receives Supabase service-role credentials.

### Callback

Add a dedicated Content Factory callback route:
- callback auth is a random token whose SHA-256 hash is persisted in the automation job payload;
- duplicate callbacks are idempotent;
- success registers generation provenance, Media Library asset/link, content item asset URL and marketing event;
- failure updates generation state and:
  - requeues the same automation job with bounded backoff if attempts remain;
  - otherwise marks terminal failure;
- callback cannot mutate a sibling artist/content item.

The successful automation job may be marked completed after detached dispatch acceptance; callback failure is allowed to transition that same row back to queued for retry.

## Workstream D — bounded Marketing heartbeat

The Marketing cron must stop running an unbounded serial full sweep.

Introduce a heartbeat budget, with:
- a hard internal start-new-work cutoff comfortably below Vercel's 55-second maximum;
- every step started only while budget remains;
- explicitly bounded batch sizes for Marketing events/jobs;
- queue kicks grouped/serialized only where the shared Media Worker requires single concurrency;
- heavy state reconciliation / Next Best Actions functions receive smaller batch limits or resumable scopes;
- skipped work is reported as `deferred`, not as success;
- failures remain isolated per step.

Do not use `Promise.race(timeout)` as fake cancellation for database/provider work. Bound work at the source instead.

## Workstream E — Media Worker route and queue semantics

Update generic Media Worker queue paths so:
- quota/capacity errors are distinguishable from busy;
- repeated cron invocations respect persisted per-job backoff where the queue has JSONB state;
- the route returns a recoverable degraded result for capacity exhaustion rather than an opaque 500 when no data corruption occurred;
- duplicate callbacks/execution remain idempotent.

Where an existing queue has no safe place to persist backoff without schema change, do not invent an unrelated storage location. Keep its existing durable state and add only classification/observability now; materialize fields after Task 1's migration workflow proof if still necessary.

## TDD sequence

1. Add `tests/durable-background-execution.test.mjs` with RED assertions for:
   - quota classification + deterministic backoff;
   - Marketing media retry-not-before;
   - Content Factory route no longer imports/bootstraps Sandbox directly;
   - Content Factory creates a durable job and detached dispatch path;
   - Marketing route has an internal budget and bounded automation batch;
   - no new migration file is introduced by this task.
2. Update `tests/content-factory-runtime.test.mjs` from the obsolete 240-second synchronous contract to the new short-dispatch contract; verify RED.
3. Implement Workstream A; GREEN focused helper tests.
4. Implement Workstream B; GREEN queue contract tests.
5. Implement Workstream C; GREEN Content Factory tests.
6. Implement Workstream D/E; GREEN cron/media-worker tests.
7. Run:
   - all Task 2 focused Node tests;
   - TypeScript;
   - ESLint for changed files / normal repo command;
   - production build if feasible;
   - `git diff --check`.
8. Push a stacked draft PR only after the focused suite is green.

## Acceptance

Task 2 code is ready for review when:
- Content Factory HTTP execution is dispatch-only, not render/bootstrap-bound;
- quota failure cannot tight-loop the same persisted job;
- Marketing heartbeat starts no new work after its internal budget;
- existing claims/idempotency prevent duplicate effects;
- no new production DB migration was added;
- all focused tests and static checks are green.

Production soak acceptance remains a later runtime gate:
- zero Marketing 55-second timeouts during the launch soak;
- no tight-loop Sandbox quota errors;
- queued/retrying/terminal job state visible through existing records/telemetry.
