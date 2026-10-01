# Production Readiness Task 3 — Backup, Restore and Database Upgrade

**Parent:** `docs/superpowers/plans/2026-10-01-production-readiness-v1.md` Task 3  
**Goal:** Prove that Ensemblis can recover production database/application state into an isolated environment, define explicit recovery targets, and make the PostgreSQL upgrade decision from verified Supabase eligibility rather than assumptions.

## Constraints

- Never mutate or reset the linked production database during a drill.
- Never commit dumps, personal data, private media, provider credentials, or recovery secrets.
- Use the protected GitHub `Production` environment for production database credentials.
- Treat Supabase Storage bytes as a separate backup layer from Postgres metadata.
- Do not change Supabase-managed `auth`, `storage`, `realtime`, or extension internals to force upgrade eligibility.
- Prefer the supported Supabase CLI dump/restore flow.
- Every temporary dump and restored environment is destroyed at the end of the workflow.

## Workstream A — Recovery contract

- Add a manual protected recovery-drill workflow.
- Dump roles, schema and data with pinned Supabase CLI.
- Start a fresh isolated local Supabase stack in CI.
- Restore using the documented roles → schema → data order.
- Compare production and restored critical row counts.
- Compare RLS/policy fingerprints.
- Assert zero broken Workspace → Artist → Release → Track/Vault and Automation Job ownership relationships.
- Download one representative production Storage object, restore it into local Storage, and compare SHA-256.
- Never upload database dumps or restored data as CI artifacts.

## Workstream B — Backup ownership and recovery objectives

Private beta:
- Database RPO: 24 hours maximum, plus an independent logical backup immediately before risky database/platform operations.
- Storage RPO: 24 hours maximum for irreplaceable objects.
- RTO: 4 hours.

Public GA:
- Database RPO: 24 hours maximum on the baseline plan; if the product requires lower loss tolerance, enable a paid Supabase backup/PITR tier before GA.
- Storage RPO: 24 hours maximum with a tested off-platform copy for irreplaceable private assets.
- RTO: 2 hours.

A Free-tier project's platform backup availability is not treated as the only guaranteed recovery control. The repository owns the tested logical recovery procedure; durable off-platform retention requires a private storage target and must never use public repository artifacts.

## Workstream C — PostgreSQL upgrade preflight

Record and verify:
- current database engine/version and size;
- installed extensions;
- non-Realtime logical replication slots;
- custom MD5 login roles;
- `pg_cron` history size;
- `reg*` system-OID dependencies;
- Supabase Management API upgrade eligibility and target versions.

Application code must not rewrite Supabase-managed Realtime `reg*` columns. Supabase's eligibility response is authoritative for platform-managed blockers.

## Workstream D — Upgrade execution

An upgrade may execute only after:
1. the recovery drill is green on current production data;
2. the independent logical backup has been created and checksummed;
3. Supabase reports the project eligible;
4. the target is a supported current Supabase platform version;
5. a maintenance window is accepted because the database and associated services are unavailable during the upgrade.

After upgrade:
- verify project health and database version;
- require exact migration parity;
- run Studio/database/browser smoke;
- re-run Supabase security/performance advisors;
- inspect runtime/database errors;
- record evidence in `docs/operations/restore-drill-log.md`.

## Definition of done

- Recovery workflow is merged and green against production.
- Restore evidence proves ownership, lineage, RLS/policies, durable jobs and representative Storage recovery.
- RPO/RTO and backup ownership are documented.
- Upgrade preflight is recorded.
- PostgreSQL is upgraded when Supabase reports a safe eligible target, followed by application/advisor verification.
