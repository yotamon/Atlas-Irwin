# Production Supabase migration delivery

This document defines the steady-state production database migration contract for Ensemblis / Atlas Irwin.

The repository migration directory is the canonical schema history:

```text
supabase/migrations/<14-digit UTC timestamp>_<snake_case_name>.sql
```

Once a migration exists on `main`, its filename and SQL are immutable. Any correction must be a new forward migration.

## Current status

Production migration history is now **exactly canonical**. The normal production workflow is implemented in the repository but remains fail-closed until its two remaining protected deployment credentials are configured.

The 2026-10-01 recovery completed the previously audited drift:

- repository: 147 canonical migrations;
- production history: 147 migration records;
- tracking-only timestamp drift: 0;
- canonical-only migrations: 0;
- production-only migrations: 0;
- `20260819164000_marketing_creative_brand_media.sql` is applied;
- `brand_reference`, `brand_logo`, and `brand_motion_reference` are present in `public.media_asset_type`.

The complete before/after evidence is documented in `docs/production-database-recovery-2026-10-01.md`. The September document remains historical forensic context only.

The GitHub Environment `Production` now requires explicit reviewer approval. `SUPABASE_PROJECT_ID` is configured there; `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` are still required before the workflow can perform a real deployment proof.

## Pre-merge protection

`.github/workflows/database-pr.yml` is the mandatory pre-merge database quality gate. It:

1. tests the migration-history and recovery classifiers;
2. rejects edits, deletes, or renames of existing migration files;
3. rejects malformed, duplicate, or backdated new migration filenames;
4. replays the complete migration history on a clean local Supabase database;
5. lints Postgres functions;
6. runs database behavior tests.

These checks intentionally require no production credential.

## Read-only recovery audit

`scripts/audit-supabase-migration-recovery.mjs` is a forensic/history classifier. It compares canonical filenames with live Management API migration history by logical migration name and reports:

- exact version/name matches;
- name-matched timestamp drift;
- canonical migrations missing from remote history;
- remote-only migration records;
- duplicate-name, duplicate-version, and same-version/different-name ambiguity.

It never changes Supabase. A missing remote history record is **not** by itself proof that SQL is missing; schema readback is required before deciding whether to repair tracking or execute SQL.

The script exists for recovery and diagnosis. It is not the steady-state deployment gate.

## Fail-closed steady-state parity contract

`scripts/check-supabase-migration-parity.mjs` is the production deployment gate after recovery.

Pre-deploy mode:

```bash
node scripts/check-supabase-migration-parity.mjs --allow-pending
```

This succeeds only when production is an **exact prefix** of canonical local history. The only tolerated difference is a contiguous suffix of new local migrations waiting to deploy.

Post-deploy mode:

```bash
node scripts/check-supabase-migration-parity.mjs
```

This requires exact version-and-name equality.

Both modes fail on the first divergent version/name and on any remote-only migration. They never repair history automatically.

## Production credential precondition

Issue #146 deliberately requires real authentication before an active production workflow is committed.

Create a GitHub Environment named `production`, require explicit deployment approval, and store production credentials only there:

- `SUPABASE_ACCESS_TOKEN`: a dedicated Supabase deployment PAT. Prefer a token scoped to this project and only the permissions required by migration history/deployment. Never use the application service-role key.
- `SUPABASE_DB_PASSWORD`: the production database password required by the supported Supabase CLI path.
- `SUPABASE_PROJECT_ID`: `zhyjnpajlvwwbvuryeyv`.

Do not expose these values to application runtime code, preview deployments, pull-request jobs, or logs.

The GitHub connector used during repository maintenance cannot create or read Actions secrets/environments, so this remains an explicit account-level setup step. The repository must not pretend the workflow can authenticate before that setup is real.

## One-time recovery is not normal deployment

The 2026-09-14 recovery used special handling for historical gaps. As of the 2026-10-01 audit, do not reuse the old nine-file `--include-all` procedure. Re-audit the live project and apply only the smallest reviewed recovery required for the remaining canonical SQL gap and history divergence.

Any `migration repair` remains a manual recovery-only action after schema readback proves tracking-only drift. It must never become part of the steady-state production workflow.

After recovery:

- do not use `--include-all` in the normal production workflow;
- do not run `migration repair` automatically;
- do not silently retry a failed database mutation;
- never run `db reset --linked` against production.

## Workflow to enable after recovery and credential setup

Only after production migration history is exactly canonical **and** the protected `production` GitHub Environment can authenticate should `.github/workflows/database-production.yml` be added.

The job should:

1. trigger on pushes to `main` only when `supabase/migrations/**` changed;
2. declare `environment: production`;
3. use a repository-wide concurrency lock such as `production-supabase-migrations` with `cancel-in-progress: false`;
4. install a pinned, reviewed Supabase CLI version;
5. run `node scripts/check-supabase-migration-parity.mjs --allow-pending` before any mutation;
6. link exactly `SUPABASE_PROJECT_ID` with the dedicated deployment credential;
7. run `supabase db push --dry-run` and fail on ambiguity;
8. run one non-interactive normal `supabase db push` with no automatic retry;
9. run `node scripts/check-supabase-migration-parity.mjs` after deployment;
10. perform a lightweight database/history readback.

A failed or ambiguous deployment stops for human inspection. The workflow must never infer success from a partial log or run `migration repair` as an automatic fallback.

## Recovery and rollback

Prefer forward fixes.

- **Additive migration:** add a new corrective migration and deploy normally.
- **Destructive/data migration:** require an explicit recovery plan before merge; confirm backup/PITR expectations and isolate irreversible transformations for review.
- **History mismatch:** repair tracking only after proving actual schema state. Never use history repair as a substitute for missing SQL.
- **Partial failure:** inspect both database state and `supabase_migrations.schema_migrations` before choosing the next action. Never blindly retry.

## Vercel

`vercel.json` already uses the official Ignored Build Step mechanism through `scripts/vercel-ignore-build.mjs`. `supabase/` is deployment-neutral there, so migration-only commits skip the unnecessary Vercel application build while mixed commits still build normally.
