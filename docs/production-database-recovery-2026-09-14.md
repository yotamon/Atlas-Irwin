# Production database recovery audit — 2026-09-14

This is the one-time recovery plan for Supabase production project `zhyjnpajlvwwbvuryeyv` before issue #146 can enable automatic production migration delivery.

It is deliberately separate from the steady-state deployment contract in `docs/production-database-migrations.md`.

## Safety status

No production mutation was performed while producing this audit. Every Supabase inspection was read-only.

Do not execute this recovery until all of the following are true:

- the repository revision containing this document has passed Database PR CI;
- a protected GitHub Environment named `production` exists;
- explicit deployment approval is required for that environment;
- `SUPABASE_ACCESS_TOKEN` is a dedicated Supabase deployment token, preferably scoped to this project and never the application service-role key;
- `SUPABASE_DB_PASSWORD` is stored only in the protected environment;
- `SUPABASE_PROJECT_ID=zhyjnpajlvwwbvuryeyv` is configured there;
- the live recovery audit is rerun immediately before mutation and still matches the expected shape below.

Never use `supabase db reset --linked` against production.

## What the audit proved

The repository contains 145 canonical migrations. Production currently records 137 distinct migration names. Of the production names, 136 have a canonical logical-name counterpart and one is a production-only recovery record:

```text
20260904014123_operational_artist_scope_growth_engine_repair
```

The production-only repair recreated the artist-scoped Growth Engine functions after an earlier manual migration problem. Its stored SQL explicitly restores the canonical operational-artist-scope definitions. It is a migration-history artifact, not a separate product feature.

A schema-level comparison between production and a clean replay of the complete canonical migration history found no unexplained drift outside the missing migrations listed below. The audit covered relations, constraints, indexes, policies, triggers, views, enum values, storage buckets and column semantics. All 2,107 existing column semantics matched once physical column ordinal history was ignored.

All 186 existing application function contracts matched. Apparent function-body differences were traced to formatting/minification, SQL comments, or later canonical function redefinitions. The final targeted source audit found no production-only executable function behavior that needs a new convergence migration. For example, the production guard that excludes `source = 'attribution'` from `private.emit_metric_marketing_event()` is already canonical in `20260818221456_attribution_metrics_loop.sql`.

## Genuine missing canonical SQL

Nine canonical migrations are genuinely absent from production. This conclusion comes from the schema/readback audit, not from migration history alone. They must not be marked applied before their SQL has executed successfully.

| Order | Canonical migration | Classification | Dependency notes |
| ---: | --- | --- | --- |
| 1 | `20260819164000_marketing_creative_brand_media.sql` | interior gap | Additive enum values only. Production readback confirmed all three values are absent. |
| 2 | `20260909191000_automix_transition_previews.sql` | interior gap | Adds private preview storage, transition-preview table, validation, triggers and RLS. Existing Automix prerequisites are present. |
| 3 | `20260910002000_dj_intelligence_reset.sql` | pending tail | Adds/reset delete policies and grants on already-present DJ intelligence tables. |
| 4 | `20260910004500_dj_library_devices.sql` | pending tail | Foundation for device/source/sync/job tables and RPCs. Must precede the following DJ Library migrations. |
| 5 | `20260910005000_dj_library_pairing_lint_fix.sql` | pending tail | Replaces pairing claim RPC. Requires `dj_library_devices`. |
| 6 | `20260910005500_dj_library_planning_evidence.sql` | pending tail | Adds planning evidence and replaces sync revision RPC. Requires `dj_library_devices`. |
| 7 | `20260910010000_dj_library_render_jobs.sql` | pending tail | Extends device jobs with render-mixplan lineage. Requires `dj_library_devices` and Automix. |
| 8 | `20260910013000_remove_serato_from_dj_library_sources.sql` | pending tail | Narrows allowed source kinds. Requires `dj_library_devices`. |
| 9 | `20260913010000_ensemblis_project_sync.sql` | pending tail | Adds the path-free local-first cloud project replica/mutation log and RPCs. |

The canonical timestamp order above is also the dependency-safe execution order. In particular:

```text
dj_library_devices
        │
        ├──► pairing_lint_fix
        ├──► planning_evidence
        ├──► render_jobs
        └──► remove_serato
```

Do not split or reorder that chain during recovery.

## Tracking-only timestamp drift

Many of the 136 name-matched production migrations were recorded under the timestamp at which they were manually applied rather than the canonical repository filename timestamp. Examples include:

| Logical migration | Canonical | Production history |
| --- | --- | --- |
| `social_channel_connections` | `20260819180000` | `20260819162101` |
| `track_music_intelligence` | `20260821165000` | `20260821151355` |
| `dj_library_history_evidence` | `20260910001500` | `20260910154008` |

Do not maintain a handwritten timestamp-repair list. Immediately before cutover run the history classifier against the dated audited baseline:

```bash
node scripts/audit-supabase-migration-recovery.mjs \
  --expect-baseline scripts/fixtures/production-migration-recovery-2026-09-14.json
```

The dated baseline includes a SHA-256 fingerprint of every production migration version/name pair, so even a single timestamp/name change invalidates the preflight. The classifier also reports every `TRACKING <remote> -> <canonical>` pair, `MISSING_HISTORY` entry, remote-only entry, and any duplicate/collision ambiguity.

A `MISSING_HISTORY` result does not prove that migration SQL is missing. The current nine-file SQL gap was established separately through schema readback.

`migration repair` changes only `supabase_migrations.schema_migrations`; it does not execute or undo schema SQL. Therefore a timestamp may be repaired only after the schema audit has established that the logical migration's effect is already present.

## Exact one-time cutover sequence

### 1. Freeze and seal the before-state

No other production migration operation may run during recovery.

Save all of the following as deployment evidence:

```bash
supabase migration list
node scripts/audit-supabase-migration-recovery.mjs --json \
  --expect-baseline scripts/fixtures/production-migration-recovery-2026-09-14.json
```

Expected baseline shape from the 2026-09-14 audit:

```text
canonical migrations     145
production history       137
name-matched production  136
production-only records    1
genuine SQL gaps            9
```

If the strict baseline check fails, stop and re-audit. Do not adapt repair commands on the fly.

The dated fingerprint is a **pre-mutation seal**. Use it exactly once immediately before the first repair. Any successful repair intentionally changes production history, so subsequent checks use the live classifier without `--expect-baseline`.

### 2. Canonicalize name-matched history

For every `TRACKING` pair emitted by the sealed before-state audit, repair only the tracking row:

```bash
supabase migration repair <REMOTE_VERSION> --status reverted
supabase migration repair <CANONICAL_VERSION> --status applied
```

Do not run the migration SQL during this phase. The audited schema effect is already present.

After each complete revert/apply pair or small reviewed batch, run:

```bash
node scripts/audit-supabase-migration-recovery.mjs
```

Do not reuse the dated fingerprint after mutation has started. The live classifier must show the expected tracking drift shrinking without introducing new remote-only names, missing-history entries, ambiguity, or collisions. Any unexpected change is a hard stop.

### 3. Remove the obsolete Growth Engine repair history row

Only after a fresh schema/function readback still confirms canonical Growth Engine behavior, remove the production-only bookkeeping entry:

```bash
supabase migration repair 20260904014123 --status reverted
```

This removes only the migration-history row. It does not roll back the Growth Engine SQL.

Continue with the live classifier, not the dated pre-mutation fingerprint.

### 4. Verify the recovery set before SQL mutation

Run:

```bash
node scripts/audit-supabase-migration-recovery.mjs
```

It must show:

- no tracking-only timestamp drift;
- no remote-only migrations;
- exactly the nine `MISSING_HISTORY` migrations listed above;
- no ambiguity or version collision.

Then preview the supported Supabase recovery push:

```bash
supabase db push --include-all --dry-run
```

The dry run must list exactly the nine canonical migration files above, in canonical timestamp order, and nothing else.

`--include-all` is required only for this one-time recovery because two missing migrations are historical interior gaps. Never replace this dry-run review with a blind push.

### 5. Apply the audited recovery set exactly once

If and only if the dry run is exact:

```bash
supabase db push --include-all
```

Run it once. Do not automatically retry on failure. A partial failure requires a fresh database/readback/history inspection before deciding the next action.

### 6. Require exact post-recovery parity

Immediately after a successful push:

```bash
node scripts/check-supabase-migration-parity.mjs
supabase migration list
```

The parity script must report exact equality. Then perform readbacks for at least:

- all three `media_asset_type` brand values;
- `public.automix_transition_previews`;
- `public.dj_library_devices` and its dependent DJ Library tables/RPCs;
- the Serato source-kind restriction;
- `public.ensemblis_project_replicas` and `public.ensemblis_project_mutations`;
- `bootstrap_ensemblis_project_replica_v1` and `commit_ensemblis_project_mutation_v1`.

Any mismatch keeps #146 open and production automation disabled.

## Steady state after recovery

`--include-all` is a recovery-only tool. The future production workflow must return to the stricter normal contract:

```text
main migration history
        │
        ▼
production exact prefix?
        │
    no ─┴─► STOP
        │ yes
        ▼
supabase db push --dry-run
        │
        ▼
one normal supabase db push
        │
        ▼
exact post-deploy parity
```

The active production workflow is still intentionally absent until the protected GitHub Environment and real deployment credentials exist. Once those account-level preconditions are true, add the workflow described in `docs/production-database-migrations.md` and close #146 only after a real additive migration proves the path end-to-end.
