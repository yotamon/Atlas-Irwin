# Ensemblis Creative Schema Rollout (2026-11-04)

## Read-only evidence

The Ensemblis production Supabase project has **150** applied canonical migrations. The repository has **152**. Both histories match exactly through the 150th version, with no extra production versions and no name mismatches.

The only missing canonical versions, in deployment order, are:

1. `20261005003000_living_artwork_media_jobs`
2. `20261006003000_release_visual_derivative_strategy`

Read-only SQL on production on 2026-11-04 confirmed:

- `marketing_media_jobs` has **zero** rows violating the proposed job type constraint, and currently has the old `finish_social_video`-only constraint.
- `creative_derivatives` has **zero** rows violating the proposed strategy constraint, and currently supports `reuse_approved_image` and `deterministic_video_repackage`.
- There are no currently present distinct job types or derivative strategies (the aggregates returned `null`). A later re-check before approval is mandatory.

These migrations relax allowable values and add an index, but change constraints with `ALTER TABLE`. On a busy database these changes can still require locks; deployment must be planned, observed and approved.

## Guarded operator execution

The production workflow is `.github/workflows/database-production.yml`. It retains automatic migration deployment on future migration-file pushes to `main` and now supports an explicit manual dispatch for backlog recovery.

A manual run requires:

1. Select **Production Database Migrations** from GitHub Actions on **main**.
2. Supply this exact batch input:
   `20261005003000_living_artwork_media_jobs,20261006003000_release_visual_derivative_strategy`
3. Approve the **Production** Environment from the authenticated repository owner account.
4. Verify the required environment secrets are available: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`.
5. The workflow verifies current production is an exact repository prefix, checks that the requested ordered batch exactly matches the actual pending versions, links the production project, performs a `supabase db push --dry-run`, performs one canonical `supabase db push --yes` and requires exact post-deploy parity.

The batch preflight fails if new migrations appear, versions drift, the batch is reordered or a requested version is already applied. No migration history repair, reset, or `--include-all` is allowed.

## After approval

Read back all 152 migration versions and verify:

- `pg_get_constraintdef` for `marketing_media_jobs_job_type_check` includes `normalize_loop_video` and `render_loop_visualizer`.
- `pg_get_constraintdef` for `creative_derivatives_strategy_check` includes `deterministic_image_recompose`.
- Index `marketing_media_jobs_artist_type_status_idx` exists.
- Supabase security advisor results have no new critical findings.
- Living Artwork worker can create a legitimate queued job, complete a controlled render, read media assets back and recover from one induced failure. **Do not use real public publishing** for this smoke.
- Artist scoping and worker permissions still pass end-to-end.

## Rollback approach

Treat constraint modification as an operational schema deployment, not a reversible UI change. Do not auto-revert by blindly reinstating older constraints if new job rows exist; that could reject legitimate data. Prefer a forward-only audited repair migration after reviewing the exact new rows and dependencies, and retain your normal database backup/point-in-time recovery procedures.

## Remaining acceptance gates

This run does not approve copyright/AI declarations, Instagram publication, real distributor delivery or audio mastering quality. Track these separately under #297.
