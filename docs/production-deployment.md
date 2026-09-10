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
