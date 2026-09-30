# Ensemblis Production Readiness v1

**Status:** Canonical launch-readiness specification  
**Parent tracker:** #263  
**Product roadmap:** `docs/ensemblis-product-roadmap.md`  
**Audit baseline:** 2026-10-01  
**Production reference:** Atlas Irwin on Ensemblis Sites

## 1. Goal

Move Ensemblis from a feature-rich system that is already serving production traffic to a production-grade v1 that can safely support external users.

This document is intentionally broader than the product roadmap. The roadmap defines what Ensemblis should become. This specification defines the operational, reliability, security, data-safety, customer-lifecycle and quality conditions that must be true before we call the product launch-ready.

The launch rule is simple:

> A feature is not production-grade because it works once. It is production-grade when it behaves predictably under failure, has bounded recovery, protects tenant data, is observable, and has an explicit customer-facing lifecycle.

## 2. Launch levels

### Private beta

Allowed when the product is used by a small, known group and support can be hands-on.

Required:
- every P0 data-safety and reliability blocker is closed;
- critical workflows have deterministic recovery;
- tenant isolation is proven;
- product limitations are explicit;
- no user is promised a feature that depends on exhausted capacity.

Billing and broad legal/commercial automation may remain out of scope if the beta is free and invitation-only.

### Public GA

Required:
- all P0 items in this document are complete with evidence;
- all user-visible v1 features have production journeys and safe failure states;
- Privacy Policy, Terms, subprocessors, retention and account data controls exist;
- monitoring and incident response can detect critical failures without waiting for user reports;
- no unfinished specialist subsystem is presented as a normal-path promise.

### Paid GA

Requires Public GA plus:
- plan/entitlement model;
- checkout and subscription state;
- payment failure and grace-period behavior;
- cancellation and entitlement revocation;
- invoice/receipt expectations;
- support path appropriate for paying customers.

## 3. Verified baseline on 2026-10-01

The audit that created #263 verified the following.

### Repository and deployment

- Current `main`: `fa6daf0f215cb1e4f42599557c598762023857f7`.
- Current Vercel production deployment for that SHA is `READY`.
- CI passed Studio product contracts, TypeScript, ESLint, production dependency audit, production build and browser smoke.
- There were no open pull requests at audit time.
- The repository contains substantial contract, database and media-worker test coverage.

### Database

- Supabase project is `ACTIVE_HEALTHY`.
- Production PostgreSQL is 17.6.1.
- The Supabase organization is on the Free plan.
- Local canonical migration count: 147.
- Production migration-history count: 147.
- Exact parity is not yet true:
  - 81 name-matched migrations have tracking-only timestamp drift;
  - canonical `20260819164000_marketing_creative_brand_media.sql` is missing remotely;
  - production-only `operational_artist_scope_growth_engine_repair` remains.
- The 81 timestamp mismatches are history-only drift whose schema effects were previously audited as present; they still must be canonicalized before steady-state exact-prefix deployment can be enabled.
- The missing migration is not history-only drift. Its three `media_asset_type` enum values are absent in production:
  - `brand_reference`;
  - `brand_logo`;
  - `brand_motion_reference`.
- Production migration delivery is not yet automated.

### Runtime reliability

Vercel production errors in the seven-day audit window included:
- repeated Content Factory failures caused by Vercel Sandbox Hobby quota exhaustion;
- Marketing cron runs exceeding the 55-second runtime limit;
- Media Worker queue Gateway Timeout;
- Next Best Actions Gateway Timeout;
- Marketing state-reconciliation Gateway Timeout.

The existing code classifies Sandbox 402 responses correctly, but classification is not capacity. A critical path remains unavailable when the quota is exhausted.

### Security and performance

The live Supabase advisors reported:
- 13 RLS-enabled/no-policy notices;
- 2 anonymous `SECURITY DEFINER` warnings;
- 11 authenticated `SECURITY DEFINER` warnings;
- leaked-password protection disabled on the current Free plan;
- 202 unindexed-foreign-key notices;
- 62 RLS init-plan warnings;
- 194 multiple-permissive-policy warnings;
- 97 unused-index notices.

These counts are audit inputs, not instructions to perform bulk migrations. Existing security documentation already establishes intentional exceptions for some private/server-only tables and externally callable RPCs. Changes must remain evidence-driven.

### Quality and customer lifecycle

- Product-quality gates exist in `config/product-quality-gates.json`.
- The evaluator correctly treats missing measurements as missing rather than passed.
- Current measurements in the repository are examples, not production evidence.
- The broad Studio user journey is not covered by browser E2E from account creation through track intelligence, creative/release work and failure recovery.
- The repository did not contain a complete product Privacy Policy, Terms of Service, subprocessors inventory, full account deletion/export lifecycle or hosted SaaS subscription/billing implementation at audit time.

## 4. Production-readiness workstreams

### PR-01 - Exact database parity and safe migration delivery

**Priority:** P0  
**Existing issues:** #146, #147

Required end state:
- production schema/history has a documented canonical relationship to `supabase/migrations`;
- the missing brand-media migration is applied only after a fresh readback proves the expected state;
- the production-only recovery history record is handled explicitly and never silently ignored;
- `scripts/check-supabase-migration-parity.mjs` passes under the intended steady-state contract;
- a protected production deployment workflow performs normal forward migration delivery;
- the workflow cannot use `--include-all`, automatic `migration repair`, blind retry or linked reset in steady state.

Acceptance evidence:
- before/after parity output;
- clean local migration replay and DB tests;
- production readback of the three expected enum values;
- one real post-recovery additive migration delivered through the automated path;
- rollback/recovery notes for the exercised migration.

### PR-02 - Durable background execution and capacity independence

**Priority:** P0

Required end state:
- request/cron handlers schedule bounded work instead of owning long-running orchestration;
- durable job state is persisted before work begins;
- work is idempotent;
- retries use bounded attempts and backoff;
- terminal failure is visible and recoverable;
- no critical product promise depends on a Vercel Sandbox quota that can be exhausted without a fallback;
- Marketing automation cannot be interrupted by the request runtime deadline.

The target execution shape is:

`trigger -> durable job -> claim/lease -> worker -> checkpoint -> result/retry -> terminal state`

Acceptance evidence:
- tests for duplicate delivery, worker death, lease expiry, timeout, quota exhaustion and retry;
- production health signal for queued/running/retrying/failed work;
- a controlled failure drill demonstrating recovery;
- zero unhandled Marketing cron runtime timeouts during the launch soak window.

### PR-03 - Backups, restore and database upgrade safety

**Priority:** P0

Required end state:
- production database backup policy is explicit;
- user media/storage backup expectations are explicit;
- backup data is stored outside the failure domain it protects against where practical;
- a restore drill has been performed and documented;
- recovery point and recovery time expectations are stated;
- PostgreSQL is upgraded to a current supported security-patched release through a documented preflight/backup/verify process.

The product must not claim a disaster-recovery capability that has never been exercised.

Acceptance evidence:
- dated backup artifact/record;
- dated restore drill with verification queries;
- post-upgrade extension/function/application smoke results;
- documented rollback/escalation path.

### PR-04 - Evidence-driven database security/performance hardening

**Priority:** P1 after PR-01

Required end state:
- each Supabase security warning is classified as fix, intentional exception or platform-plan limitation;
- server-only RLS/no-policy tables are verified to have no unintended direct grants;
- externally callable `SECURITY DEFINER` functions have explicit reviewed authorization and `search_path`;
- high-value RLS init-plan warnings are fixed without changing authorization semantics;
- indexes are added or removed only with query/delete-path evidence.

Do not bulk-fix advisor counts.

Acceptance evidence:
- updated advisor audit;
- authorization regression tests;
- query-plan evidence for performance changes;
- no widened private-schema access.

### PR-05 - Release engineering and protected delivery

**Priority:** P0/P1

Required end state:
- pull requests that can affect runtime run a production build before merge;
- required checks are defined and enforced on `main`;
- production database mutations use a protected environment with explicit approval;
- release/rollback procedure identifies exact Git SHA, Vercel deployment and DB migration state;
- production verification never assumes merged code is live until the serving deployment SHA matches.

Acceptance evidence:
- required-check configuration or documented repository setting;
- failing-build fixture proves merge gate catches build-only failures;
- successful controlled rollback rehearsal.

### PR-06 - Critical-journey E2E and measured product-quality gates

**Priority:** P0

Browser E2E must cover, at minimum:
- authentication and first entry;
- create/select artist;
- import music;
- analysis/intelligence reaches a usable state;
- Best Moments are available;
- Create or another downstream action preserves lineage;
- release workflow can reach its intended v1 completion point;
- worker/provider failure produces a recoverable user state;
- two users/two artists cannot cross-read or cross-mutate protected data;
- core mobile and keyboard journeys.

The quality framework must move from example measurements to real evidence.

Required end state:
- strict release evaluation consumes generated production-quality measurements;
- missing measurements fail the release gate for metrics designated required;
- Track Intelligence private benchmark remains outside the public repo but records a dated pass/fail result;
- onboarding time-to-first-useful-recommendation and intervention counts are measured.

### PR-07 - Observability, SLOs and incident operations

**Priority:** P0

Required end state:
- one health model covers web, database, worker and background-job dependencies;
- critical failures generate actionable alerts;
- every durable execution carries a trace/execution identifier;
- dashboards or equivalent queries answer:
  - are users able to sign in?
  - are track jobs completing?
  - are queues growing?
  - are crons running?
  - are provider errors or quotas degrading features?
  - is spending outside expected bounds?
- incident severity, rollback owner and communication path are documented.

Initial SLO candidates:
- production web availability;
- critical API success rate;
- track-analysis completion success/rate;
- durable-job terminal-success rate;
- queue-age ceiling;
- onboarding critical-journey success rate.

Exact numeric targets should be chosen from measured baseline rather than invented here.

### PR-08 - GDPR, privacy and account data lifecycle

**Priority:** P0 for Public GA

Required end state:
- users can request/export product-owned personal data;
- users can delete their account through a controlled lifecycle;
- deletion handles workspace/artist ownership safely;
- consent revocation is explicit by channel/purpose where applicable;
- retention rules exist for user records, audio, generated media, analytics, logs and provider artifacts;
- deletion jobs are auditable without retaining deleted personal content unnecessarily;
- Fan Graph behavior remains consent-aware and does not infer permission.

Acceptance evidence:
- E2E/export tests;
- deletion tests including multi-member workspace edge cases;
- post-deletion readback;
- retention matrix.

### PR-09 - Legal launch surface

**Priority:** P0 for Public GA

Repository-owned launch documentation must include:
- Privacy Policy;
- Terms of Service;
- subprocessors/provider inventory;
- AI/media processing disclosures where required by product behavior;
- contact route for privacy/security requests;
- retention/deletion summary consistent with PR-08.

These documents should describe actual behavior, not aspirational behavior.

### PR-10 - Product v1 scope closure

**Priority:** P1

The product roadmap still has real last-mile work:
- broader Mission semantics;
- complete Artist Memory lifecycle and audience-assistance traceability;
- Smart Link/pre-save lifecycle;
- complete autonomy checks at external-effect boundaries;
- Distribution provider last mile;
- Paid Growth provider completeness;
- CRM relationship journeys;
- full provenance/rights manifest.

These are not all blockers if the incomplete surface is clearly excluded from v1.

Required end state:
- one explicit v1 capability matrix;
- unfinished capabilities are hidden, disabled or clearly labeled;
- no normal-path CTA leads into an incomplete workflow;
- Advanced surfaces remain available only where safe and useful.

### PR-11 - Commercial lifecycle

**Priority:** P2; required for Paid GA only

Required if Ensemblis charges for hosted service:
- canonical plans and capability entitlements;
- checkout;
- webhook/idempotency handling;
- active, trial, past-due, canceled and expired states;
- grace-period policy;
- cancellation and entitlement revocation;
- invoices/receipts/support expectations;
- billing E2E sandbox tests.

The existing desktop entitlement/licensing contracts may inform capability modeling, but hosted subscriptions must not be inferred from them.

## 5. Dependency order

P0 execution order:

1. PR-01 database parity.
2. PR-02 durable execution and quota independence.
3. PR-03 backup/restore, then database upgrade.
4. PR-05 release protections.
5. PR-06 E2E and real quality evidence.
6. PR-07 observability/SLOs.
7. PR-08 customer data lifecycle.
8. PR-09 legal surface.
9. Launch rehearsal and soak.

PR-04 can begin after PR-01 stabilizes canonical DB history.

PR-10 can proceed in parallel once P0 reliability work is not being destabilized.

PR-11 starts only after the launch business model is explicitly paid; it must be complete before Paid GA.

## 6. Launch evidence ledger

Every readiness item must close with evidence. A checkbox without evidence is not completion.

Store durable evidence in the repository when it contains no secret or personal data. Examples:
- CI/run URL or commit SHA;
- migration parity output summary;
- advisor summary;
- restore drill date and result;
- load/failure test summary;
- quality measurement artifact summary;
- production deployment SHA;
- runbook path.

Never commit:
- production secrets;
- private audio;
- personal user exports;
- raw access tokens;
- sensitive incident payloads.

## 7. Non-goals

This program does not require:
- finishing every future Ensemblis feature before v1;
- paying for a more expensive provider solely to silence an advisor;
- bulk-creating every suggested index;
- replacing stable product architecture without evidence;
- making Advanced/specialist tooling part of the normal artist journey;
- building billing for an invitation-only free beta.

## 8. Definition of done

Ensemblis v1 is production-grade when:

- all #263 P0 items are checked with evidence;
- `main`, production deployment and database state are mutually identifiable;
- critical asynchronous work survives request timeout, duplicate delivery and worker/provider failure;
- disaster recovery has been exercised;
- tenant isolation and critical journeys pass E2E;
- required product-quality measurements pass strict release evaluation;
- critical production degradation creates an alert;
- external users have accurate privacy/terms/data controls;
- the advertised v1 surface contains no known incomplete normal-path workflow;
- paid customers, if enabled, have a complete billing lifecycle.

The implementation sequence is defined in `docs/superpowers/plans/2026-10-01-production-readiness-v1.md`.
