# Production Supabase migration delivery

This document defines the production database migration contract for Ensemblis / Atlas Irwin.

The repository migration directory is the canonical schema history:

```text
supabase/migrations/<14-digit UTC timestamp>_<snake_case_name>.sql
```

Once a migration exists on `main`, its filename and SQL are immutable. Any correction must be a new forward migration.

## Current status

Production migration delivery is **not automated yet**.

As of 2026-09-14, the live Supabase migration history is not byte-for-byte aligned with the canonical repository timestamps. The mismatch is real and must be repaired before `supabase db push` is allowed to run automatically.

Representative examples observed against production project `zhyjnpajlvwwbvuryeyv`:

| Migration | Canonical repository version | Production history version |
| --- | --- | --- |
| `social_channel_connections` | `20260819180000` | `20260819162101` |
| `track_music_intelligence` | `20260821165000` | `20260821151355` |
| `dj_library_history_evidence` | `20260910001500` | `20260910154008` |

Production is also missing canonical migrations **inside** the historical sequence, not only at the tail. `20260819164000_marketing_creative_brand_media.sql` is absent from migration history while later migrations are recorded. A schema readback confirmed its three `media_asset_type` enum values (`brand_reference`, `brand_logo`, `brand_motion_reference`) are also absent, so this is a genuine skipped migration rather than tracking drift.

The repository also contains newer migrations that are not represented in the current production history, including `20260913010000_ensemblis_project_sync.sql`.

A production schema readback on 2026-09-14 confirmed that `20260913010000_ensemblis_project_sync.sql` is genuinely pending, not merely missing from migration tracking: `public.ensemblis_project_replicas`, `public.ensemblis_project_mutations`, `bootstrap_ensemblis_project_replica_v1`, and `commit_ensemblis_project_mutation_v1` were all absent. During history repair this migration must remain pending until its SQL is actually deployed.

The older timestamp mismatches are consistent with migrations having been applied manually under server-generated execution timestamps. Their schema effects must still be verified individually before migration tracking is repaired. Because production contains at least one genuine interior gap, the cutover requires a complete gap audit rather than timestamp repair alone. Supabase CLI migration parity is timestamp-based, so applying `db push` before repairing history can attempt to replay logically existing work or encounter missing prerequisites out of canonical order.

## Pre-merge protection

`.github/workflows/database-pr.yml` is the mandatory pre-merge database quality gate. It now performs four independent checks:

1. tests the migration-history guard itself;
2. rejects edits, deletes, or renames of existing migration files;
3. rejects malformed, duplicate, or backdated new migration filenames;
4. replays the complete migration history on a clean local Supabase database, then lints and runs database behavior tests.

The append-only guard intentionally needs no production credential.

## Fail-closed production parity contract

`scripts/check-supabase-migration-parity.mjs` compares canonical local migrations with Supabase Management API migration history.

Pre-deploy mode:

```bash
node scripts/check-supabase-migration-parity.mjs --allow-pending
```

This succeeds only when production is an **exact prefix** of the canonical local history. The only tolerated difference is a contiguous suffix of new local migrations waiting to be deployed.

Post-deploy mode:

```bash
node scripts/check-supabase-migration-parity.mjs
```

This requires exact version-and-name equality.

Both modes fail on the first divergent version/name and on any remote-only migration. They never repair history automatically.

Required environment values:

- `SUPABASE_PROJECT_ID`: the production project ref (`zhyjnpajlvwwbvuryeyv`);
- `SUPABASE_ACCESS_TOKEN`: a dedicated project-scoped Supabase PAT used only by deployment automation.

## One-time production history repair

Do not repair migration history by timestamp alone and do not assume two migrations are equivalent because their names look similar.

For every mismatch or gap:

1. Run `supabase migration list` against production and save the before-state.
2. Match each production migration to a canonical repository file by migration name and intended SQL/schema effect.
3. Verify the expected schema/readback for each canonical migration, including local migrations missing from remote history.
4. If the schema change is already present but only the history timestamp is wrong, use `supabase migration repair` to mark the incorrect production version reverted and the canonical repository version applied. `migration repair` changes migration tracking only; it does not execute or undo migration SQL.
5. If a canonical migration is genuinely not applied, keep it unapplied until it can be executed in a reviewed, dependency-safe order. Do not mark it applied merely to obtain parity.
6. If production contains a migration with no trustworthy canonical repository equivalent, stop. Capture the production schema difference into a reviewed migration before continuing.
7. After genuine interior gaps are safely executed, repair their canonical versions as needed and continue until production history becomes an exact canonical prefix.
8. Require `node scripts/check-supabase-migration-parity.mjs --allow-pending` to report only a contiguous local suffix before enabling automated delivery.
9. After the pending canonical suffix is deployed, require exact parity with `node scripts/check-supabase-migration-parity.mjs`.

Never run `db reset --linked` against production.

## Production credential precondition

Issue #146 deliberately requires authentication to exist before an active production workflow is committed.

Create a GitHub Environment named `production` and require explicit deployment approval. Store production credentials only in that environment.

Use:

- `SUPABASE_ACCESS_TOKEN`: a dedicated Supabase PAT scoped to this production project. Prefer a scoped PAT and grant only the permissions required by the CLI/parity path. It must never be the application service-role key.
- `SUPABASE_DB_PASSWORD`: the production database password required by the supported Supabase CLI deployment flow.
- `SUPABASE_PROJECT_ID`: environment variable or secret containing `zhyjnpajlvwwbvuryeyv`.

Do not expose these values to application runtime code, preview deployments, pull-request jobs, or logs.

The GitHub connector used during repository maintenance cannot create/read Actions secrets, so the environment secret wiring is intentionally a manual account-level step rather than a fake or unauthenticated workflow.

## Workflow to enable after the preconditions are true

Only after migration history is aligned **and** the `production` GitHub Environment can authenticate should `.github/workflows/database-production.yml` be added.

The production job should:

1. trigger on pushes to `main` only when `supabase/migrations/**` changed;
2. declare `environment: production`;
3. use a repository-wide concurrency lock such as `production-supabase-migrations`, with `cancel-in-progress: false`;
4. install a pinned Supabase CLI version;
5. run the parity checker with `--allow-pending` before any mutation;
6. link to exactly `SUPABASE_PROJECT_ID` using the dedicated deployment credential;
7. run `supabase db push --dry-run` and fail on any ambiguity;
8. run one non-interactive `supabase db push` with no automatic retry;
9. run the parity checker again without `--allow-pending`;
10. perform a lightweight readback that proves the database is reachable and the migration history is exact.

A failed or ambiguous production deployment must stop for human inspection. Do not automatically run `migration repair`, retry destructive SQL, or infer success from a partial log.

## Recovery and rollback

Prefer forward fixes.

- **Additive migrations:** add a new corrective migration and deploy it normally.
- **Destructive/data migrations:** require an explicit recovery plan before merge. Confirm backup/PITR expectations and make irreversible data transformations separately reviewable.
- **History mismatch:** repair tracking only after verifying actual schema state. Never use migration-history repair as a substitute for applying missing SQL.
- **Partial failure:** inspect the database and `supabase_migrations.schema_migrations` before deciding the next action. Do not blindly retry.

## Vercel

`vercel.json` already uses the official Ignored Build Step mechanism through `scripts/vercel-ignore-build.mjs`. `supabase/` is deployment-neutral there, so migration-only commits skip the unnecessary Vercel application build while mixed commits still build normally.
