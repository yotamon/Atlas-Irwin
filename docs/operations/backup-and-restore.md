# Ensemblis Backup and Restore

## Purpose

This runbook defines the recovery contract for Ensemblis production. It covers PostgreSQL state, Supabase Storage object bytes, authentication/ownership state, durable jobs, provider credentials and the PostgreSQL platform-upgrade safety boundary.

The canonical automated drill is `.github/workflows/database-recovery-drill.yml`. It runs only on manual dispatch and uses the protected GitHub `Production` environment.

## Recovery objectives

| Stage | Database RPO | Irreplaceable Storage RPO | RTO | Notes |
| --- | --- | --- | --- | --- |
| Private beta | 24 hours max | 24 hours max | 4 hours | Take an independent logical backup immediately before risky DB/platform changes. |
| Public GA | 24 hours max baseline | 24 hours max | 2 hours | If business tolerance requires less than 24h loss, enable Supabase paid backup/PITR before GA. |
| Paid/high-value operation | Define per commercial SLO | Define per asset class | Define per SLO | Do not infer a lower RPO from Free-tier behavior. |

Supabase currently recommends that Free-plan projects regularly export their data with `supabase db dump` and maintain off-site backups. Platform backup availability on Free is not treated as the only guaranteed recovery control.

## What must survive

### PostgreSQL

The logical backup must preserve the state needed to reconstruct the product:

- Auth users and identity records needed to reconnect users.
- Workspaces and workspace memberships.
- Artists and artist ownership.
- Releases, tracks, Track Vault and Media Library metadata.
- Moments, campaigns, learning/memory evidence and distribution state.
- Durable worker/automation job state.
- RLS policies, functions, triggers, constraints, indexes and migration-related schema state.
- Provider connection metadata that is stored in Postgres.

The recovery drill compares critical production/restored row counts, fingerprints public RLS/policies and rejects broken ownership/lineage.

### Supabase Storage

**Database backups do not include Storage object bytes.** They preserve database metadata about Storage, not the S3 object bodies themselves.

Current production inventory on 2026-10-01:

- `public-media`: 41 objects, 488,232,792 bytes.
- `automix-previews`: empty.
- `studio-assets`: empty.
- `studio-private`: empty.

The automated drill downloads one representative current `public-media` object, restores it into the isolated local Storage service and requires an exact SHA-256 match.

Before public GA, every bucket that can contain irreplaceable private user media must have a private off-platform object-copy path. Never place raw or encrypted customer backups in a public repository or public CI artifact.

### Provider credentials and Vault

Provider secrets require two distinct recovery expectations:

1. Database-backed encrypted/token records are covered only when the corresponding managed encryption/Vault mechanism is recoverable.
2. Environment-level secrets, OAuth client secrets, Vercel secrets and GitHub environment secrets are configuration, not database data. They must be recreated from the organization credential inventory.

A database restore does not by itself recreate OAuth dashboard configuration, redirect URLs, API keys, Vercel environment variables or GitHub secrets. Users may need to re-authenticate after a disaster recovery cutover.

### Reproducible vs irreplaceable generated media

- Regenerable derived media may be recovered by reconstructing the durable job and provenance lineage.
- Artist-uploaded masters, source footage, artwork, human-approved finals and other non-reproducible assets are irreplaceable and require object-byte backup.
- A database row that points at a missing object is not a successful restore.

## Automated recovery drill

The workflow:

1. Authenticates through the protected `Production` environment.
2. Captures production critical row counts and public RLS/policy fingerprint.
3. Creates ephemeral `roles.sql`, `schema.sql` and `data.sql` with pinned Supabase CLI.
4. SHA-256 checksums all dump files.
5. Queries Supabase's upgrade eligibility endpoint when a Management API token is provisioned; restore verification does not depend on that optional control-plane credential.
6. Starts a fresh local Supabase stack on the CI runner.
7. Restores roles → schema → data in one fail-closed restore transaction.
8. Requires exact critical row-count and RLS/policy fingerprint equality.
9. Requires zero critical Workspace/Artist/Release/Track/Vault/Job ownership or lineage orphans.
10. Round-trips one representative Storage object and compares SHA-256.
11. Destroys the local stack and every dump file.
12. Never uses `actions/upload-artifact` for production data.

### Running it

Use GitHub Actions → **Production Database Recovery Drill** → **Run workflow**.

The job intentionally targets the protected `Production` environment and therefore inherits the same approval/credential boundary as production migration delivery.

## Independent backup before risky changes

Before a PostgreSQL platform upgrade, migration-history repair, large destructive migration or other high-risk operation:

1. Run the recovery drill against current production.
2. Require it to pass.
3. Confirm the logical dump was created and checksummed during that run.
4. If the operation could outlive the ephemeral workflow, create a separately retained encrypted off-platform logical backup using a private storage target.
5. Confirm the Storage object backup/copy is current for irreplaceable assets.
6. Record the recovery point and expected RPO in `restore-drill-log.md`.

Do not store database dumps, personal exports or private masters in this public GitHub repository.

## Restore decision tree

### Application/schema regression

Prefer normal application rollback and forward database repair. Do not restore the whole database when a smaller reviewed repair preserves newer user data.

### Logical data corruption or accidental deletion

Choose the newest verified recovery point before the corruption, quantify the RPO, and restore into isolation first. Verify ownership, RLS, lineage and Storage before promoting any recovered environment.

### Total project loss

Recreate infrastructure, restore database state, restore Storage bytes separately, recreate Auth/provider configuration and secrets, rotate credentials where appropriate, then run the full post-restore verification checklist.

## PostgreSQL upgrade discipline

Production currently runs PostgreSQL 17.6 (Supabase build 17.6.1.127). An upgrade may start only after a green recovery drill.

Preflight must verify:

- database size and expected downtime;
- no application-owned `reg*` system-OID dependencies;
- no non-Realtime logical replication slots;
- no unsupported/deprecated installed extensions;
- no custom MD5 login roles;
- `pg_cron` history is not large enough to create upgrade disk pressure;
- Supabase Management API reports the project eligible and exposes a supported target.

The four currently observed `reg*` columns are inside Supabase's managed `realtime` schema. Do not modify them from application migrations to force eligibility. Supabase's platform eligibility result is authoritative.

The upgrade itself causes database/service downtime. After it finishes, require:

- project status healthy;
- expected PostgreSQL/platform version;
- exact canonical migration parity;
- Studio contract/type/lint/build checks;
- browser smoke;
- critical production route smoke;
- security/performance advisor comparison;
- no new material database/runtime error cluster.

## Recovery evidence

Every drill or upgrade appends a dated entry to `docs/operations/restore-drill-log.md` with:

- source production SHA/deployment;
- workflow run;
- database version/size;
- dump checksums recorded by the workflow (never dump contents);
- row/RLS/lineage/Storage result;
- upgrade eligibility;
- any gap that changes RPO/RTO;
- post-upgrade checks if applicable.
