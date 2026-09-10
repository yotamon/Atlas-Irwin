# Production deployment

Ensemblis / Atlas Irwin production is deployed from the `main` branch of `yotamon/Atlas-Irwin` through the Vercel project `atlas-irwin` in the CartShift team.

## Source of truth

- Git repository: `yotamon/Atlas-Irwin`
- Production branch: `main`
- Vercel project: `atlas-irwin`
- Production domains include `atlasirwin.com` and `www.atlasirwin.com`

A pull request being merged is not sufficient proof that a change is live. A production change is considered deployed only when Vercel has a `READY` deployment whose Git commit SHA matches the intended `main` commit (or a later `main` commit containing it).

## Verification checklist

1. Confirm the intended commit is present on `main`.
2. Confirm Vercel created a deployment after that commit was pushed.
3. Confirm the deployment target is `production`.
4. Confirm the deployment state is `READY`.
5. Confirm the deployment Git SHA matches the intended `main` commit or a descendant that contains it.
6. For UI changes, verify at least one affected route against the production deployment after promotion.

If Vercel rejects deployments because the Hobby API deployment quota has been exhausted, wait until deployment capacity is available again and then retrigger from `main`; do not treat a merged commit as live until the verification checklist above passes.

This document exists so release completion is never inferred from GitHub merge state alone.
