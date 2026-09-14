# Script fixtures

`production-migration-recovery-2026-09-14.json` is a fail-closed snapshot of the production migration-history shape audited for issue #146.

It is not application configuration and contains no credentials. Use it only with:

```bash
node scripts/audit-supabase-migration-recovery.mjs \
  --expect-baseline scripts/fixtures/production-migration-recovery-2026-09-14.json
```

If production history or canonical migration count changes before the approved recovery, the baseline check must fail and the recovery must be re-audited rather than silently adjusted.

After #146 has completed the one-time production recovery and exact parity is established, remove this dated baseline fixture and its recovery-only documentation in a follow-up cleanup PR. The general recovery classifier may remain as a diagnostic tool.
