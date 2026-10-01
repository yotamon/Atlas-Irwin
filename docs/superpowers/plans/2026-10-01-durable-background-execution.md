# Durable Background Execution — Task 2 Implementation Plan

**Parent plan:** `docs/superpowers/plans/2026-10-01-production-readiness-v1.md`  
**Readiness workstream:** Task 2  
**Goal:** Prevent request timeouts and Vercel Sandbox capacity exhaustion from terminally failing durable work or causing repeated redundant dispatch attempts.

## Scope

This child plan deliberately reuses existing durable domain state:

- `automation_jobs` for Marketing automation jobs;
- existing publication/outreach queues for external effects;
- existing Media Worker-backed job tables for Track/Stem/Video/Mastering/AutoMix/Marketing Media;
- existing callback + stale-job recovery contracts.

Do not create a parallel generic queue unless the existing domain tables prove insufficient.

## Failure contracts

1. **Sandbox capacity exhaustion is not a job failure.**
   - A 402/429/quota/Hobby capacity response returns work to a durable pending state.
   - It must not consume a terminal retry budget merely because platform capacity is unavailable.
   - No paid fallback is introduced implicitly.

2. **Busy shared worker is a scheduling state, not a failure.**
   - Once one queue reports active/busy/capacity blocked, the same heartbeat must not probe every other shared-worker queue.

3. **Marketing heartbeat is bounded.**
   - Time-sensitive recovery/publication work runs every heartbeat with small explicit limits.
   - Non-critical maintenance is divided into rotating lanes.
   - One invocation must not serially own every Marketing subsystem.

4. **External effects keep their existing idempotency/autonomy boundaries.**
   - Publication, outreach and spend logic remain inside their current durable queues and approval contracts.

## RED/GREEN sequence

### A. Shared Media Worker capacity

- Add tests for a central capacity classifier.
- Add static/contract tests proving all shared-worker queue callers defer capacity failures rather than mark rows terminally failed.
- Add heartbeat contract test proving busy/capacity short-circuits later shared-worker queue probes.

### B. Bounded Marketing heartbeat

- Add contract test proving:
  - publication/outreach use bounded limits;
  - maintenance work is split into rotating lanes;
  - automation-cycle event/job limits are configurable and bounded;
  - the route no longer awaits every maintenance subsystem on every request.

### C. Content Factory degradation

- Add capacity classification for Vercel Sandbox errors.
- On platform capacity exhaustion, return a successful degraded outcome rather than a 500.
- Preserve the missing asset for a future retry; do not mark content complete or use a paid provider.

## Verification

- Targeted Node tests.
- TypeScript check.
- ESLint on changed TS.
- Production build/CI.
- Production log soak after merge:
  - no 55-second Marketing cron timeout;
  - no terminal shared-worker job failure caused solely by Sandbox quota;
  - no repeated same-heartbeat multi-queue capacity probes.
