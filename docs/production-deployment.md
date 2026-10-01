# Production deployment

Ensemblis and the Atlas Irwin public site are deployed from this repository through the linked Vercel project.

## Canonical production source

- `main` is the only Git branch allowed to create automatic production deployments.
- Feature and pull-request branches do not deploy automatically.
- A merged change is not considered live until the Vercel production deployment reports `READY` for a commit that contains that merge.
- When verifying a production bug fix, compare the production deployment's `githubCommitSha` with the current `main` SHA before assuming the browser is serving the merged code.

The branch policy is enforced in `vercel.json` through `git.deploymentEnabled`.

## Verification checklist

After merging a production-facing change:

1. Confirm `main` contains the expected commit.
2. Confirm Vercel created a new production deployment for `main`.
3. Confirm the deployment reaches `READY`.
4. Confirm the deployment metadata references the expected `githubCommitSha` or a newer commit that contains it.
5. Only then verify the behavior on the production domain.

If GitHub has advanced but Vercel has not created a deployment, treat production as stale and investigate the Git integration or trigger a fresh `main` Git event rather than diagnosing the old production bundle as current code.
## Database recovery and upgrade gate

A production database/platform upgrade is not considered safe merely because the application deployment is healthy.

Before a Supabase/PostgreSQL upgrade or other high-risk database operation:

1. Run the protected **Production Database Recovery Drill** workflow.
2. Require exact restored critical row counts and public RLS/policy fingerprint.
3. Require zero critical ownership/lineage orphans.
4. Require the representative Storage object SHA-256 restore check to pass.
5. Confirm the workflow created and checksummed an independent logical backup.
6. Confirm Supabase upgrade eligibility and the intended target version.
7. Confirm canonical production migration parity is exact.
8. Record the recovery point and expected RPO/RTO in `docs/operations/restore-drill-log.md`.

After the upgrade, repeat migration parity, CI/product contracts, browser smoke, production health/error checks and Supabase advisor readback before declaring the database healthy.

The full procedure is in `docs/operations/backup-and-restore.md`.

