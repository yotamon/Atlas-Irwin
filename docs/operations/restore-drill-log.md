# Restore Drill Log

This file contains non-sensitive recovery evidence only. Production row contents, object names, credentials and backup files are never recorded here.

## 2026-10-01 — Task 3 baseline

**Status:** implementation prepared; first protected drill pending.

### Source inventory

- Supabase project: Atlas Irwin (`eu-central-1`).
- Project health: `ACTIVE_HEALTHY`.
- PostgreSQL: 17.6 / Supabase build 17.6.1.127.
- Database size: 34 MB.
- Auth users: 1.
- Workspaces: 1.
- Workspace memberships: 1.
- Artists: 1.
- Releases: 5.
- Tracks: 16.
- Track Vault rows: 5.
- Media asset rows: 37.
- Durable automation jobs: 10.
- Storage buckets: 4.
- Storage objects: 41.
- `public-media` bytes: 488,232,792.

### Upgrade preflight snapshot

- Non-Realtime logical replication slots: 0.
- Custom MD5 login roles: 0.
- `cron.job_run_details`: 3,071 rows / ~2.0 MiB.
- Installed application/platform extensions include `pgcrypto`, `supabase_vault`, `pg_stat_statements`, `uuid-ossp`, `pg_cron`, `pg_net`, and `plpgsql`.
- Deprecated PostgreSQL-17 extensions `timescaledb`, `plv8`, `plcoffee`, `plls`, and `pgjwt` are not installed.
- Four `reg*` columns exist only in Supabase-managed `realtime` objects; no application table owns one.
- Supabase security/performance advisor findings were captured for the later Task 4 evidence-driven hardening workstream; no bulk advisor-driven DDL is part of Task 3.

### Pending evidence

The first `Production Database Recovery Drill` workflow must still prove:

- logical dump/restore succeeds into isolated local Supabase;
- critical row counts match;
- public RLS/policy fingerprint matches;
- ownership/lineage orphan count is zero;
- representative Storage object restores byte-for-byte;
- Supabase upgrade eligibility/target is recorded.

Update this entry after the first successful protected workflow run.
