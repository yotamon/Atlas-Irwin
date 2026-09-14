# Supabase security advisor audit — 2026-09-14

This document records the live, read-only security audit performed for issue #147 against production project `zhyjnpajlvwwbvuryeyv`.

It deliberately separates current findings from stale issue text and from changes that must wait until the production migration recovery in #146 is complete.

## Safety boundary

No production DDL, Auth configuration, grants, migration history, or application data was changed during this audit.

Until #146 completes the sealed production migration recovery, do not merge a new migration file. The recovery baseline intentionally pins the current canonical migration count and production history fingerprint.

## Current advisor findings

The current Supabase security advisor reports four categories:

| Finding | Current count | Audit conclusion |
| --- | ---: | --- |
| RLS enabled with no policy | 4 | Intentional isolation for the audited tables; direct API-role grants are absent except the server-only runtime-secrets path. |
| Anonymous `SECURITY DEFINER` RPC | 2 | Intentional public endpoints: Smart Link event collection and published-site hostname resolution. |
| Authenticated `SECURITY DEFINER` RPC | 11 | Intentional application RPCs. They use explicit `search_path = ''` and enforce authentication / artist or admin scope as appropriate. |
| Leaked-password protection disabled | 1 | Real Auth configuration warning. Supabase documents leaked-password protection as Pro-plan-and-above functionality, so this cannot be resolved while intentionally remaining on the Free plan. |

Advisor references:

- RLS/no-policy: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- anonymous `SECURITY DEFINER`: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- authenticated `SECURITY DEFINER`: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- leaked-password protection: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## `private` remains private

Live privilege readback confirms `anon`, `authenticated`, and `service_role` have neither `USAGE` nor `CREATE` on schema `private`.

The advisor's three private token-table RLS/no-policy findings are therefore not a reason to create permissive policies:

- `private.social_channel_tokens`
- `private.soundcloud_tokens`
- `private.spotify_tokens`

None has a direct table grant to `anon`, `authenticated`, or `service_role`.

`public.automation_runtime_secrets` is also RLS-enabled with no policy. It has no direct `anon` or `authenticated` read grant. `service_role` retains the intentional server-only table privileges.

The regression test `supabase/tests/security_advisor_contracts_test.sql` freezes these boundaries. Do not silence the advisor by widening `private` schema access or adding client policies to secret tables.

## Public views

All current public views explicitly use `security_invoker=true`:

- `artist_activation_readback`
- `moment_performance_rollups`
- `smart_link_readback`
- `verified_creative_learning_evidence`
- `verified_moment_learning_evidence`

No view migration is required for the stale security-definer-view concern in #147.

## `pg_net`

Production currently has `pg_net` version `0.20.3` installed in schema `extensions`, not `public`.

No relocation migration is required. Moving it again would add risk without fixing a current finding.

## Externally callable `SECURITY DEFINER` RPCs

Every current public `SECURITY DEFINER` function executable by `anon` or `authenticated` has an explicit function-level `search_path`.

Exactly two are intentionally anonymous:

- `record_smart_link_event(...)`: sessionless public Smart Link event collection.
- `resolve_artist_site_hostname(text)`: public published-site hostname routing.

The authenticated advisor findings are intentional application RPCs. The audited functions use `search_path = ''` and perform explicit authentication and/or canonical artist/admin checks before privileged work.

The database regression contract fails if a third anonymous `SECURITY DEFINER` RPC appears or if an externally callable public `SECURITY DEFINER` function loses its explicit search path.

## Stale mutable-search-path list in #147

The function names originally listed in #147 are no longer present in the live database. The live audit found a different set of 14 functions whose configured search path still contains mutable application schemas.

### Current hardening candidates

Private AI feedback / creative helpers:

- `private.ai_feedback_variant_status()`
- `private.ai_feedback_content_edit()`
- `private.ai_feedback_video_concept_selected()`
- `private.ai_feedback_video_plan_approved()`
- `private.ai_feedback_regenerated_run()`
- `private.ai_feedback_campaign_run_linked()`
- `private.ai_feedback_metric_snapshot()`
- `private.insert_ai_feedback(uuid,uuid,text,text,uuid,numeric,numeric,jsonb)`
- `private.finalize_creative_derivative_from_media_job()`
- `private.guard_ai_content_approval()`
- `private.assert_campaign_spend_actor(uuid)`

Public legacy Campaign AI Spend RPCs:

- `public.reserve_campaign_ai_spend(uuid,uuid,uuid,text,numeric)`
- `public.settle_campaign_ai_spend(uuid,uuid,numeric,text)`
- `public.release_campaign_ai_spend(uuid,uuid,text)`

Their canonical definitions currently use either `search_path = public, private` or `search_path = pg_catalog, public, private`. The audited bodies already qualify application relations/functions through `public.*` / `private.*`, while PostgreSQL built-ins remain available through `pg_catalog` semantics.

After #146 production recovery, harden these in one small forward migration using signature-specific statements equivalent to:

```sql
alter function ... set search_path = '';
```

Do not rewrite the function bodies solely to change configuration. Preserve existing owners, `SECURITY DEFINER`/invoker mode, grants, and trigger bindings.

Before merging that migration, add a regression assertion that zero `public`/`private` application functions retain `public` or `private` in their configured search path unless an explicit reviewed exception is documented.

## Performance advisor triage

Current performance advisor volume is large:

- 190 unindexed foreign-key findings;
- 52 RLS init-plan findings;
- 194 multiple-permissive-policy findings;
- 93 unused-index findings.

These counts are an inventory, not a to-do list.

Do not bulk-create 190 indexes, bulk-rewrite RLS, bulk-collapse policies, or drop 93 indexes from advisor output alone. #147 requires evidence from actual access patterns, referential delete/update paths, and query plans.

### Measured production scale

A live catalog readback of the currently populated core paths shows why advisor count alone is not enough to justify broad index work:

- `moments`: approximately 80 rows;
- `releases`: approximately 5 rows;
- `content_items`: approximately 4 rows;
- `campaigns`: approximately 1 row;
- many newer Smart Links, Paid Growth, Distribution and Creative Memory tables have not accumulated enough rows for meaningful planner statistics yet.

At this scale, adding dozens of speculative indexes would increase write/storage overhead and maintenance complexity without measurable user benefit. Revisit index candidates as these event/lineage tables grow or when query plans show sequential-scan cost on real workloads.

### RLS init-plan candidates worth carrying forward

The targeted audit found direct `auth.uid()` calls, rather than the planner-reusable `(select auth.uid())` form, in these high-value feature areas:

- `creative_asset_profiles`: insert/select/update owner policies;
- `creative_memory_events`: insert/select owner policies;
- `distribution_release_metadata`: select/insert/update/delete policies;
- `moment_calibration_events`: artist/admin select policy;
- `paid_growth_events`: select policy;
- `paid_growth_experiments`: select/insert/update policies;
- `paid_growth_observations`: select policy;
- `paid_growth_operations`: select policy.

These form a sensible post-#146 RLS optimization batch because they are modern Ensemblis paths likely to become read-heavy. The semantic predicate must remain identical; only wrap stable Auth lookups as `(select auth.uid())` where Supabase/Postgres can reuse the init plan.

Do not combine that optimization with policy consolidation unless an `EXPLAIN` or concrete API workload shows the multiple-permissive-policy structure itself is materially costly.

### Foreign-key index candidates

The targeted FK audit found many unindexed single-column foreign keys across the same feature areas, but production volume is currently too small to justify bulk creation. When these paths grow, prioritize indexes that protect high-cardinality event/lineage tables and parent deletion/update checks, especially Smart Link events/sources, Paid Growth events/operations, Creative Memory events, and Distribution event/submission lineage.

Before adding each index, verify that an existing composite index does not already provide the same leading-column access path and capture the query/delete workload that benefits from it.

The first performance pass after production recovery should therefore be small and evidence-driven: fix the identified direct Auth RLS calls, then add only FK/query indexes supported by actual growth or plans.

## Remaining non-database action

Leaked-password protection remains disabled. Supabase's current password-security documentation states that this protection is available on Pro and above and is configured in Auth settings. While the project stays on Free, keep this warning documented rather than introducing an unrelated paid-plan change.

If the project moves to Pro later, enable leaked-password protection in Auth settings and verify sign-up, sign-in, password-change, and recovery behavior before marking that acceptance criterion complete.
