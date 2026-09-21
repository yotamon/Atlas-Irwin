# Vercel resource policy

This repository shares the free CartShift team quota with other projects.

## Deployment triggers

- Automatic Git deployments are enabled for `main` only. Ordinary feature branches must not create a deployment on every push.
- Validate locally first. Create a Preview explicitly only when a review needs a running URL, using the Vercel CLI or dashboard.
- Existing branches must merge/rebase the current `main` before relying on this policy: Vercel reads configuration from the deployed source.
- Keep one deployment path per commit. Do not add a second automatic deployment workflow alongside the Git integration.
- Keep the conservative ignored-build script. It saves build work for proven deployment-neutral changes, but a canceled build still counts toward Vercel's deployment quota.
- Preserve security checks, type checks, production routes, and required runtime files. Do not hide failing checks to save resources.

## Retained output and uploads

- `.vercelignore` excludes agent workspaces and generated diagnostics from source uploads. This is not a substitute for inspecting actual build output.
- Do not package APKs, test recordings, reports, source archives, or vendor documentation in public assets.
- Batch related code changes and validate locally before requesting another Preview.

## Account settings to verify separately

These are dashboard settings, not values enforced by this repository:
- Compare Deployment Storage and Functions Storage by project in team Usage.
- Suggested retention: 7 days for Preview, canceled, and errored deployments; 30 days for production, subject to the options available on Hobby.
- Preserve the current production deployment and useful rollback versions. Retention exceptions may preserve active branch previews and aliased deployments.
- Shorter retention reduces future stored usage; it does not erase already accrued GB-month usage.
- Keep the free plan. Do not enable paid resources or upgrades as an automatic response to a quota warning.

## References

- https://vercel.com/docs/project-configuration/git-configuration
- https://vercel.com/docs/project-configuration/project-settings#ignored-build-step
- https://vercel.com/docs/deployment-storage/optimize

## Font vendor documents

The original vendor PDFs are preserved in `docs/font-vendor-materials/` rather than shipped from `public/fonts/`. Font binaries and in-place license notices remain unchanged. The move removes 7,082,712 bytes of non-runtime PDF assets from each subsequent successful deployment before any storage deduplication.
