# Production database recovery — 2026-10-01

**Status:** Recovery complete; canonical parity restored.  
**Project:** Ensemblis production Supabase project `zhyjnpajlvwwbvuryeyv`  
**Parent readiness tracker:** #263  
**Database delivery tracker:** #146

## Before-state

The sealed production readback immediately before mutation showed:

- 147 canonical repository migrations;
- 147 production migration-history rows;
- 81 name-matched migrations with tracking-only timestamp drift;
- one genuinely missing canonical migration: `20260819164000_marketing_creative_brand_media.sql`;
- one production-only history row: `20260904014123_operational_artist_scope_growth_engine_repair`;
- zero `brand_reference`, `brand_logo`, or `brand_motion_reference` labels in `public.media_asset_type`.

The pre-mutation history fingerprint was:

```text
bd00989736df08e877fd3d0019405ef13dfa1348e10263885db9275d1c1e43c3
```

The repository guard for this state is:

```text
scripts/fixtures/production-migration-recovery-2026-10-01.json
```

## Recovery performed

1. Canonicalized all 81 tracking-only timestamps in one asserted transaction.
2. Removed the obsolete Growth Engine recovery-history row in the same transaction.
3. Re-read production history and proved:
   - 0 tracking-only mismatches;
   - 0 production-only history rows;
   - exactly one canonical migration still missing.
4. Applied the exact canonical SQL for `marketing_creative_brand_media`:
   - add `brand_reference`;
   - add `brand_logo`;
   - add `brand_motion_reference`.
5. Canonicalized the migration history version back to `20260819164000`.
6. Re-read the complete production history.

No table rows, user data, storage objects, policies, grants, functions, or existing enum labels were deleted or rewritten by the missing canonical migration.

## After-state

Production now matches repository migration history exactly:

```text
canonical migrations   147
production history     147
tracking-only drift      0
canonical-only           0
production-only          0
```

The three expected brand-media enum labels are present in production.

Supabase security/performance advisors were rerun after the DDL. The known advisory categories remained present; this additive enum migration did not introduce a new schema-security surface.

## GitHub production environment

The existing GitHub Environment `Production` now requires an explicit reviewer approval by repository owner `yotamon` and permits deployments from the `main` branch only.

Database Verification run `36789026170` on PR #266 proved the repository state on a clean GitHub runner:

- migration-history guards: pass;
- append-only migration-history validation: pass;
- clean replay of all 147 canonical migrations: pass;
- Postgres function lint: pass;
- database behavior tests: pass.

Environment deployment inputs:

- `SUPABASE_PROJECT_ID`: configured;
- `SUPABASE_ACCESS_TOKEN`: still required;
- `SUPABASE_DB_PASSWORD`: still required.

The repository workflow is fail-closed when either required credential is absent.

## Remaining proof for #146

Exact parity recovery is complete. #146 remains open until the normal forward-only workflow is proven end-to-end with a new harmless additive migration after the two remaining deployment credentials are stored in the protected `Production` environment.

The proof run must demonstrate:

1. predeploy exact-prefix parity;
2. dry-run contains only the new additive migration;
3. exactly one normal `db push`;
4. exact postdeploy parity;
5. lightweight history/schema readback.

Do not use `--include-all`, automated `migration repair`, or linked reset in steady state.
