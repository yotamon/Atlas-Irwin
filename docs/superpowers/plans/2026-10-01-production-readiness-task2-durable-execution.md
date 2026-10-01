# Production Readiness Task 2 — Durable Background Execution

**Parent plan:** `docs/superpowers/plans/2026-10-01-production-readiness-v1.md`  
**Task:** 2 — Make Marketing and Content Factory execution durable  
**Branch:** `feat/production-readiness-task2-durable`

## Goal

Remove request-time orchestration and Sandbox quota exhaustion as critical-path failure modes without introducing a second generic queue or a new database migration.

## Existing primitives to reuse

- `public.automation_jobs` already provides durable job state, `run_after`, attempt/max-attempt counters, idempotency keys, `SKIP LOCKED` claiming and exponential retry.
- Media workloads already persist in domain-specific rows (`music_video_worker_jobs`, `track_stem_jobs`, `track_mastering_jobs`, `automix_jobs`, `automix_transition_previews`, `marketing_media_jobs`, Track Vault analysis JSON).
- The shared Media Worker already enforces concurrency 1 with a Sandbox lock.
- Supabase `pg_cron` calls the marketing heartbeat every 15 minutes, so incomplete durable work can continue on later heartbeats.

## Workstream A — Bounded Marketing heartbeat

### Desired behavior

`/api/cron/marketing` must:

1. authenticate;
2. recover at most one bounded music-ingestion item;
3. make at most one shared-worker dispatch attempt;
4. seed idempotent artist-scoped maintenance jobs into `automation_jobs`;
5. execute due maintenance jobs one at a time within an explicit wall-clock budget;
6. return before the 55-second route limit with remaining work still queued.

### Maintenance job types

Use `automation_jobs` rather than a new table.

Recurring every 15 minutes:
- `maintenance:state_reconciliation`
- `maintenance:publications`
- `maintenance:outreach`
- `maintenance:creative_spend`
- `maintenance:creative_derivatives`
- `maintenance:event_automation`

Recurring hourly:
- `maintenance:audience_sync`
- `maintenance:next_best_actions`
- `maintenance:manager_execution`

Recurring every 6 hours:
- `maintenance:radar`

Each artist/task pair owns one stable idempotency key. On success the same `automation_jobs` row is rescheduled by moving `run_after` forward and resetting its attempt counter; duplicate heartbeats do not create additional rows. The first seed staggers `run_after` values in maintenance order so publications/audience/radar sensing precedes initial next-best-action ranking.

### Scope contract

Add one canonical active-artist scope loader and make maintenance functions accept `{ ownerId, artistId }` where they do not already.

No maintenance job may operate on sibling artists when an artist scope is supplied.

### Budget contract

- claim one job at a time;
- check the deadline before the next claim;
- never pre-claim a batch that may outlive the request;
- retry failures through existing `automation_jobs.run_after` semantics;
- return counts plus `budgetExhausted` instead of timing out.

## Workstream B — Shared Media Worker capacity circuit

### Desired behavior

Sandbox quota/billing/resource responses are **transient capacity**, not terminal job failures.

Introduce one shared failure classifier:

- `busy`: another Media Worker job owns the concurrency lock;
- `capacity`: Vercel Sandbox quota/resource/billing/rate capacity is unavailable;
- `gone`: stale Sandbox/session and eligible for the existing one-time recreation;
- `fatal`: malformed request or other non-transient failure.

For `capacity`:

- return the claimed job to its durable planned/queued state;
- remove callback credentials and external job ids;
- persist a retry-after marker in the job's existing error/analysis metadata;
- do not consume a terminal attempt solely because provider capacity is unavailable where the domain already separates dispatch attempts;
- propagate `reason: "capacity"` to the shared queue orchestrator;
- stop trying sibling shared-worker queues in the same heartbeat;
- on later heartbeats, skip dispatch while the persisted retry-after marker is in the future.

No new paid fallback is introduced.

## Workstream C — Content Factory quota safety

Remove the eager `prepareComposerSandbox()` call from the cron route.

`fillOneMissingScheduledAsset()` already checks:

1. deployment availability;
2. free daily/monthly render quota;
3. whether a scheduled asset is actually missing;

before composition.

Only create/resume Sandbox when there is real render work. Convert Sandbox quota failure into a non-500 deferred outcome so the scheduled caller does not record routine quota exhaustion as an application error.

## Tests

### RED contracts

Create `tests/durable-background-execution.test.mjs` covering:

- Marketing cron delegates maintenance orchestration to a bounded heartbeat module instead of directly invoking the full subsystem list.
- Durable maintenance uses `automation_jobs`, idempotency keys, artist scope, single-job claim and a wall-clock deadline.
- Existing automation retry/backoff remains in use.
- Shared worker classification recognizes capacity separately from busy/fatal.
- Mastering, AutoMix, previews, media queue and marketing media queue preserve work on capacity rather than terminally failing it.
- Marketing shared-worker orchestration stops sibling dispatch attempts after capacity.
- Content Factory no longer eagerly creates a Sandbox before checking for actual work.
- Content Factory returns a deferred/non-500 capacity outcome.

### Regression

Run at minimum:

- `node --test tests/durable-background-execution.test.mjs`
- `node --test tests/content-factory-runtime.test.mjs`
- existing Media Worker / AutoMix / Mastering / marketing tests affected by changed files;
- `npm run typecheck`;
- `npm run lint`;
- `npm run build` if local runtime permits, otherwise require CI production build.

## Acceptance evidence

- No direct long-form Marketing orchestration remains in the cron route.
- Maintenance failures remain queued with bounded backoff.
- Duplicate heartbeat seeding is idempotent.
- Sandbox 402/429/quota failures do not set Mastering/AutoMix/media jobs to terminal failed.
- A capacity result prevents additional shared-worker dispatch attempts in that heartbeat.
- Content Factory quota exhaustion returns a normal deferred result, not HTTP 500.
- Production logs after deployment show no Marketing 55-second timeout and no tight-loop Sandbox quota failures during the soak window.
