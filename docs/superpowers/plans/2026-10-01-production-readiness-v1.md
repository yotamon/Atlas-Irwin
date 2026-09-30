# Ensemblis Production Readiness v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close issue #263 by making Ensemblis safe, recoverable, observable and supportable for external users without expanding product breadth.

**Architecture:** Preserve the current multi-artist Ensemblis architecture and harden the boundaries around it. Production work is organized as independently reviewable workstreams: canonical database delivery, durable background execution, recovery, security, release engineering, quality, observability, customer data lifecycle and v1 surface closure. Long-running work moves behind persisted jobs; production mutations remain fail-closed and human-reviewable.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node.js 22, Supabase/PostgreSQL, Vercel, GitHub Actions, Playwright, Node test runner, Python media worker, Tauri/Rust Local Engine.

**Spec:** `docs/production-readiness-v1.md`

## Global Constraints

- Preserve explicit Workspace -> Artist ownership and artist isolation.
- Preserve the existing Music -> Moments -> Actions -> Outcomes -> Memory product loop.
- Do not widen `private` schema access to silence Supabase advisors.
- Do not bulk-create/drop indexes or rewrite RLS policies without workload/query-plan evidence.
- Never use `supabase db reset --linked` against production.
- Normal production migration delivery must not use `--include-all` or automatic `migration repair`.
- Money, rights, sensitive communication and irreversible external effects remain approval/autonomy governed.
- Keep the current Vercel Hobby/free-resource preference where safe; free-tier limits may not remain a hidden critical-path dependency.
- Private masters, benchmark audio, secrets and personal exports must stay out of the public repository.
- Do not add a new primary navigation area for production-readiness work.
- Finish reliability before opening new breadth programs.

## Review Focus

- Duplicate/background-job delivery: the same job may be delivered twice and must not produce duplicate external effects.
- Partial database migration: a failed deployment must stop with inspectable state and must never be blindly retried or marked successful.
- Cross-artist/account lifecycle: export/deletion must never expose or delete another artist/workspace member's data.
- Provider/quota outage: Sandbox, AI, storage or distribution failure must degrade to a visible recoverable state rather than a stuck workflow.
- Restore correctness: recovered data must preserve ownership, release/track lineage, permissions and required job state, not merely row counts.

---

## Execution model

This is the master plan. Each task is a reviewer-sized workstream with its own test/evidence cycle. Before editing a subsystem with substantial implementation depth, write a focused child plan under `docs/superpowers/plans/` that references this plan and the production-readiness spec.

P0 tasks execute in order unless the task explicitly states it may proceed in parallel.

### Task 1: Reconcile production database and enable canonical migration delivery

**Files:**
- Modify: `docs/production-database-migrations.md`
- Modify: `docs/production-database-recovery-2026-09-14.md`
- Create after parity: `.github/workflows/database-production.yml`
- Modify as needed: `scripts/check-supabase-migration-parity.mjs`
- Modify as needed: `scripts/audit-supabase-migration-recovery.mjs`
- Test: `tests/migration-history-guard.test.mjs`
- Test: `supabase/tests/security_advisor_contracts_test.sql`
- Canonical migration: `supabase/migrations/20260819164000_marketing_creative_brand_media.sql`

**Interfaces:**
- Consumes: canonical migration filenames and production Management API history.
- Produces: exact steady-state parity invariant plus protected `main -> production DB` migration workflow.

- [ ] **Step 1: Write/update migration-history tests for the 2026-10-01 state**
  - Pin that the repository contains the missing canonical brand-media migration.
  - Pin fail-closed behavior for a remote-only history record.
  - Pin exact/post-deploy parity semantics.

- [ ] **Step 2: Run the migration-history tests and clean local replay**
  - Run `node --test tests/migration-history-guard.test.mjs`.
  - Run the existing Database Verification workflow commands locally/CI.
  - Expected: repository history and all DB behavior tests pass.

- [ ] **Step 3: Perform a fresh read-only production recovery audit**
  - Reconfirm the missing `marketing_creative_brand_media` SQL state.
  - Reconfirm the production-only Growth Engine history record's schema behavior is canonical.
  - Stop if the live shape differs from the 2026-10-01 audit.

- [ ] **Step 4: Apply the smallest reviewed recovery**
  - Execute the missing canonical SQL through the supported migration path.
  - Repair history only where actual schema readback proves tracking-only drift.
  - Never infer SQL execution from history alone.

- [ ] **Step 5: Verify exact production state**
  - Assert the three brand-media enum values exist.
  - Run parity checker in exact mode.
  - Run targeted application/database smoke.

- [ ] **Step 6: Add `.github/workflows/database-production.yml`**
  - Trigger only for `main` migration changes.
  - Require protected `production` environment.
  - Use pinned Supabase CLI.
  - Preflight with `--allow-pending`, dry-run, one normal push, then exact parity.
  - Use a non-canceling repository-wide migration concurrency lock.

- [ ] **Step 7: Prove the deployment path with one safe additive migration**
  - Create the migration with the Supabase CLI.
  - Merge only after local replay/tests.
  - Verify automated delivery and exact post-deploy parity.

- [ ] **Step 8: Update #146/#263 evidence and commit**
  - Record run URLs/SHAs and the final parity result.

### Task 2: Make Marketing and Content Factory execution durable

**Files:**
- Modify: `app/api/cron/marketing/route.ts`
- Modify: `app/api/cron/content-factory/route.ts`
- Modify: `app/api/cron/media-worker/route.ts`
- Modify: `lib/marketing/media-worker-queue.ts`
- Modify: `lib/media-worker/queue.ts`
- Modify: `lib/media-worker/dispatcher.ts`
- Modify: `lib/media-worker/sandbox.ts`
- Modify: `lib/media-worker/execution-telemetry.ts`
- Create/modify forward migration(s) for durable job/lease fields only after Task 1.
- Test: `tests/content-factory-runtime.test.mjs`
- Test: `tests/media-worker-*.test.mjs`
- Test: new `tests/durable-background-execution.test.mjs`

**Interfaces:**
- Consumes: existing media-worker job contracts and artist-scoped execution context.
- Produces: persisted job state with idempotent claim/lease/retry/terminal semantics.

- [ ] **Step 1: Write failing tests for timeout, duplicate delivery, lease expiry and Sandbox 402**
  - A duplicate trigger must not duplicate work/external effects.
  - A dead worker lease becomes claimable after expiry.
  - Sandbox quota exhaustion produces a bounded degraded/queued state.
  - The cron request returns after scheduling bounded work rather than waiting for long orchestration.

- [ ] **Step 2: Run focused tests and confirm the new cases fail**

- [ ] **Step 3: Define the durable job state machine**
  - Exact states: queued, claimed/running, retry_wait, succeeded, failed_terminal, canceled.
  - Persist attempt count, next attempt time, lease owner/expiry, last error class and trace ID.
  - Reuse existing job tables where they already model the domain; do not create a second generic queue unnecessarily.

- [ ] **Step 4: Refactor cron routes to schedule/claim bounded work**
  - Each HTTP invocation must do a bounded amount of work.
  - Long provider/media operations execute through the worker boundary.

- [ ] **Step 5: Add bounded retry/backoff and terminal recovery**
  - Retry only classified transient failures.
  - Never retry irreversible external effects without idempotency evidence.

- [ ] **Step 6: Add capacity-aware Sandbox behavior**
  - Do not repeatedly attempt known exhausted Sandbox capacity.
  - Surface the dependency as degraded.
  - Prefer Local Engine/other existing execution path where the product contract allows it; otherwise queue or fail clearly.

- [ ] **Step 7: Run unit/contract/media-worker tests and controlled failure simulation**

- [ ] **Step 8: Verify production soak**
  - No Marketing 55-second timeout.
  - No tight-loop Sandbox quota failures.
  - Queue age and terminal failures are observable.

### Task 3: Establish backup, restore and database upgrade discipline

**Files:**
- Create: `docs/operations/backup-and-restore.md`
- Create: `docs/operations/restore-drill-log.md`
- Modify: `docs/production-deployment.md`
- Create scripts only if automation is chosen: `scripts/backup-*.mjs` / `scripts/verify-restore-*.mjs`
- Test: script-level validation tests for any repository automation.

**Interfaces:**
- Consumes: canonical DB schema, storage inventory and production credentials held outside the repository.
- Produces: tested recovery procedure plus version-upgrade runbook.

- [ ] **Step 1: Inventory state that must survive disaster**
  - PostgreSQL data/history.
  - Supabase Storage/user media.
  - provider-token recovery expectations.
  - external/generated media that is reproducible vs irreplaceable.

- [ ] **Step 2: Define RPO/RTO and backup ownership**
  - State explicit expectations for private beta and public GA.

- [ ] **Step 3: Implement/enable backup path without committing secrets**

- [ ] **Step 4: Perform restore drill into isolated non-production environment**
  - Verify row ownership, RLS, release/track lineage, jobs and representative storage objects.

- [ ] **Step 5: Document drill evidence and gaps**

- [ ] **Step 6: Run PostgreSQL upgrade preflight**
  - Check installed extensions and application-specific incompatibilities.
  - Take/verify backup before upgrade.

- [ ] **Step 7: Upgrade and run smoke/DB/advisor verification**

### Task 4: Harden Supabase security/performance from evidence

**Files:**
- Modify: `docs/supabase-security-advisor-audit-2026-09-14.md` or create a dated successor audit.
- Create forward migration(s) after Task 1.
- Test: `supabase/tests/security_advisor_contracts_test.sql`
- Test: artist-scope and authorization contract tests affected by any policy/RPC change.

**Interfaces:**
- Consumes: live advisors, grants, `EXPLAIN` evidence and canonical RLS semantics.
- Produces: smaller verified warning set without widened access.

- [ ] **Step 1: Snapshot current security/performance findings by category**

- [ ] **Step 2: Classify every security warning**
  - fix;
  - intentional reviewed exception;
  - plan/platform limitation.

- [ ] **Step 3: Write regression tests before changing grants/RPCs/RLS**

- [ ] **Step 4: Harden mutable application `search_path` and high-value RLS init-plan cases**
  - Preserve exact authorization predicates.

- [ ] **Step 5: Add/drop indexes only where workload evidence supports the change**

- [ ] **Step 6: Re-run advisors and compare before/after behavior and plans**

### Task 5: Strengthen CI and release protection

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/database-pr.yml` only if Task 1 requires it.
- Modify: `docs/production-deployment.md`
- Test: `tests/vercel-build-budget.test.mjs`
- Test: `tests/vercel-ignore-build.test.mjs`

**Interfaces:**
- Consumes: existing `npm run build`, Studio tests, E2E and DB verification.
- Produces: pre-merge runtime build gate and documented required-check contract.

- [ ] **Step 1: Add a regression test for PR build-scope behavior**

- [ ] **Step 2: Run production build on runtime-affecting PRs before merge**
  - Keep resource-neutral docs-only changes cheap.

- [ ] **Step 3: Verify required `main` checks/branch protection in GitHub settings**
  - CI fast verification.
  - browser smoke where required.
  - Database Verification for migration changes.
  - relevant audio/library-bridge checks.

- [ ] **Step 4: Verify protected production environment for DB mutations**

- [ ] **Step 5: Rehearse application rollback to a known Vercel deployment**
  - Record Git SHA and DB compatibility constraints.

### Task 6: Add true critical-journey E2E and strict product-quality evidence

**Files:**
- Create: `e2e/studio-onboarding.spec.mjs`
- Create: `e2e/studio-music-to-moment.spec.mjs`
- Create: `e2e/studio-release.spec.mjs`
- Create: `e2e/tenant-isolation.spec.mjs`
- Create: `e2e/recovery.spec.mjs`
- Modify: `playwright.config.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/evaluate-product-quality.mjs` only if required for machine-readable output.
- Modify: `config/product-quality-gates.json` only from measured evidence.
- Create: non-sensitive measurement summary artifact path under `docs/quality/`.
- Test: `tests/product-quality-program.test.mjs`

**Interfaces:**
- Consumes: product flows and existing quality thresholds.
- Produces: release-gating evidence for critical paths and required usefulness metrics.

- [ ] **Step 1: Build deterministic authenticated E2E fixtures with at least two isolated artists/users**

- [ ] **Step 2: Write onboarding/import/intelligence/Moments journey**

- [ ] **Step 3: Write downstream Create/release lineage journey**

- [ ] **Step 4: Write tenant isolation tests**
  - Cross-artist reads and writes must fail.

- [ ] **Step 5: Write recovery journeys**
  - provider failure;
  - worker retry;
  - stale/failed analysis;
  - interrupted navigation.

- [ ] **Step 6: Add mobile/keyboard critical-path variants**

- [ ] **Step 7: Produce real quality measurements**
  - onboarding time;
  - completion;
  - critical path pass rates;
  - human interventions;
  - private Track Intelligence benchmark result.

- [ ] **Step 8: Run `quality:evaluate --strict` in the release gate for required measurements**

### Task 7: Add operational observability, SLOs and incident runbooks

**Files:**
- Modify: `lib/observability/execution-context.ts`
- Modify: `lib/platform/telemetry.ts`
- Modify: `lib/media-worker/execution-telemetry.ts`
- Create: `docs/operations/slo.md`
- Create: `docs/operations/incident-response.md`
- Create: `docs/operations/provider-degradation.md`
- Modify: `app/api/health/media-worker/route.ts` and/or add one aggregate health route only if it does not expose sensitive internals.
- Test: new observability contract tests.

**Interfaces:**
- Consumes: trace IDs, job state, Vercel/Supabase/provider signals.
- Produces: actionable health model and incident procedures.

- [ ] **Step 1: Write tests that every critical job/request carries a stable trace/execution ID**

- [ ] **Step 2: Define measurable SLIs and baseline them before setting targets**

- [ ] **Step 3: Add alert conditions for critical availability/job/quota/provider failures**

- [ ] **Step 4: Create safe health/readiness views without leaking secrets or tenant data**

- [ ] **Step 5: Write severity, triage, rollback and communication runbooks**

- [ ] **Step 6: Run a controlled incident drill and record evidence**

### Task 8: Implement GDPR/privacy/account lifecycle

**Files:**
- Create/modify API/actions under `app/api/studio/account/` or established Studio action conventions.
- Modify: `app/studio/(protected)/settings/page.tsx`
- Create: `app/studio/(protected)/settings/privacy/page.tsx`
- Create: `lib/privacy/` modules for export/deletion/retention orchestration.
- Create forward migration(s) only for missing lifecycle metadata/audit state.
- Create: `docs/privacy-data-map.md`
- Create: `docs/privacy-retention.md`
- Test: `tests/privacy-account-lifecycle.test.mjs`
- E2E: `e2e/account-data-lifecycle.spec.mjs`

**Interfaces:**
- Consumes: workspace membership, artist ownership, Fan Graph consent and provider connection state.
- Produces: explicit export, revoke, retention and deletion lifecycle.

- [ ] **Step 1: Write data-map and retention matrix before code**

- [ ] **Step 2: Write failing tests for export scope and tenant isolation**

- [ ] **Step 3: Implement account/user data export**

- [ ] **Step 4: Write deletion tests for sole-owner and multi-member workspaces**

- [ ] **Step 5: Implement staged deletion/revocation**
  - revoke provider credentials/sessions;
  - resolve ownership;
  - delete/anonymize according to documented retention;
  - record non-sensitive audit completion.

- [ ] **Step 6: Add Settings privacy UI and explicit destructive confirmation**

- [ ] **Step 7: Verify post-deletion readback and E2E**

### Task 9: Publish the legal launch surface

**Files:**
- Create: `docs/legal/privacy-policy.md`
- Create: `docs/legal/terms-of-service.md`
- Create: `docs/legal/subprocessors.md`
- Create or expose corresponding public routes under the marketing site.
- Modify public footer/navigation.
- Test: marketing website E2E for legal routes and links.

**Interfaces:**
- Consumes: Task 8 actual data behavior and provider inventory.
- Produces: accurate public legal documents and contact paths.

- [ ] **Step 1: Derive documents from the actual data map/provider behavior**

- [ ] **Step 2: Add public legal routes and footer links**

- [ ] **Step 3: Add E2E availability/accessibility tests**

- [ ] **Step 4: Review for consistency with retention/deletion implementation**

### Task 10: Freeze the v1 capability surface and finish only required product last mile

**Files:**
- Modify: `docs/ensemblis-product-roadmap.md`
- Create: `docs/v1-capability-matrix.md`
- Modify feature entry points/navigation/settings as required.
- Existing work: #120/#135, #122, #124/#126, #125/#127, #54.

**Interfaces:**
- Consumes: current roadmap and readiness status.
- Produces: one explicit list of shipped, beta/advanced and hidden capabilities.

- [ ] **Step 1: Classify every user-visible capability as GA, beta/advanced or hidden**

- [ ] **Step 2: Remove normal-path links into incomplete workflows**

- [ ] **Step 3: Finish only last-mile items required by the chosen v1 promise**
  - Artist Memory lifecycle if Memory is advertised.
  - external-effect autonomy coverage for every enabled external action.
  - Smart Link lifecycle if owned conversion is advertised.
  - Distribution/Paid Growth/provider completeness only for enabled providers.
  - provenance manifest if provenance/readiness is advertised.

- [ ] **Step 4: Run one-primary-action/accessibility/mobile regression audit**

### Task 11: Add commercial lifecycle only if launch is paid

**Files:**
- Create a dedicated child spec/plan before implementation.
- Reuse `contracts/entitlement-set.v1.json` and `lib/platform/entitlements.ts` only where semantics match hosted plans.
- Add provider-specific billing modules/routes/webhook storage after provider selection.
- Add billing E2E sandbox tests.

**Interfaces:**
- Consumes: v1 capability matrix and plan definitions.
- Produces: hosted subscription state mapped to capability entitlements.

- [ ] **Step 1: Decide billing provider and plan contract**

- [ ] **Step 2: Write webhook idempotency/state-transition tests**

- [ ] **Step 3: Implement checkout and canonical subscription projection**

- [ ] **Step 4: Implement trial/active/past-due/grace/canceled/expired behavior**

- [ ] **Step 5: Implement cancellation and entitlement revocation**

- [ ] **Step 6: Run billing sandbox E2E**

### Task 12: Run launch rehearsal and close #263

**Files:**
- Create: `docs/operations/launch-checklist.md`
- Create: `docs/operations/launch-rehearsal-<date>.md`
- Update: `docs/production-readiness-v1.md`
- Update: #263 with evidence.

**Interfaces:**
- Consumes: evidence from Tasks 1-11 as applicable.
- Produces: explicit private-beta/public-GA/paid-GA decision record.

- [ ] **Step 1: Deploy a release candidate through the real production pipeline**

- [ ] **Step 2: Run DB parity, E2E, strict quality gate and health checks**

- [ ] **Step 3: Exercise one worker failure and one application rollback**

- [ ] **Step 4: Verify backup/restore evidence is current**

- [ ] **Step 5: Verify legal/data controls and v1 capability matrix**

- [ ] **Step 6: Run a soak window and inspect alerts/errors/queue age**

- [ ] **Step 7: Record go/no-go evidence**
  - Private beta may omit paid-only Task 11.
  - Public GA requires all P0 readiness conditions.
  - Paid GA requires Task 11.

- [ ] **Step 8: Close #263 only when every applicable launch gate has evidence**

## Self-review result

- Spec coverage: all findings from the 2026-10-01 repository, Supabase and Vercel audit map to Tasks 1-12.
- Step granularity: each workstream ends in an independently reviewable/testable production result.
- Type/interface consistency: durable execution is owned by Task 2; observability consumes that state in Task 7; privacy behavior is implemented before legal copy in Tasks 8-9.
- Review Focus coverage: duplicate execution is tested in Task 2; partial migrations in Task 1; cross-tenant deletion/export in Task 8; provider/quota degradation in Tasks 2/7; restore correctness in Task 3.
- Proportion: this master plan fixes sequencing and acceptance decisions. Detailed subsystem implementation choices belong in focused child plans rather than expanding this file into code-by-prose.
