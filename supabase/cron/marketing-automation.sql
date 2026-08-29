-- Production provisioning for Atlas Marketing OS.
-- Run after the autonomous_marketing_os migration. This script is intentionally
-- outside migrations because local/CI databases should not create production cron jobs.
--
-- Free-tier policy:
--   * lightweight marketing heartbeat every 15 minutes
--   * FFmpeg Content Factory every 6 hours on a separate endpoint
--   * no paid fallback; the composer also enforces daily/monthly render caps
--
-- It generates a fresh 256-bit bearer token inside Postgres, stores only its SHA-256
-- hash in the service-only runtime table, and encrypts the raw token in Supabase Vault.
-- No Vercel CRON_SECRET is needed.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  v_secret text := encode(extensions.gen_random_bytes(32), 'hex');
  v_secret_id uuid;
begin
  select id into v_secret_id
  from vault.decrypted_secrets
  where name = 'atlas_marketing_cron_secret'
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      v_secret,
      'atlas_marketing_cron_secret',
      'Atlas Marketing OS free-tier scheduler bearer token'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_secret,
      'atlas_marketing_cron_secret',
      'Atlas Marketing OS free-tier scheduler bearer token'
    );
  end if;

  insert into public.automation_runtime_secrets(key, secret_hash)
  values ('marketing_cron', encode(extensions.digest(v_secret, 'sha256'), 'hex'))
  on conflict (key) do update
    set secret_hash = excluded.secret_hash,
        updated_at = now();
end
$$;

-- Remove the previous five-minute job and any prior safe-schedule jobs so this script is idempotent.
select cron.unschedule(jobid)
from cron.job
where jobname in (
  'atlas-marketing-every-5-min',
  'atlas-marketing-heartbeat-15-min',
  'atlas-content-factory-6-hour'
);

select cron.schedule(
  'atlas-marketing-heartbeat-15-min',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://atlasirwin.com/api/cron/marketing',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'atlas_marketing_cron_secret'
        limit 1
      )
    ),
    timeout_milliseconds := 50000
  );
  $$
);

select cron.schedule(
  'atlas-content-factory-6-hour',
  '17 */6 * * *',
  $$
  select net.http_get(
    url := 'https://atlasirwin.com/api/cron/content-factory',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'atlas_marketing_cron_secret'
        limit 1
      )
    ),
    timeout_milliseconds := 50000
  );
  $$
);

select
  exists(select 1 from public.automation_runtime_secrets where key = 'marketing_cron') as credential_hash_ready,
  exists(select 1 from vault.decrypted_secrets where name = 'atlas_marketing_cron_secret') as vault_secret_ready,
  exists(select 1 from cron.job where jobname = 'atlas-marketing-heartbeat-15-min') as heartbeat_ready,
  exists(select 1 from cron.job where jobname = 'atlas-content-factory-6-hour') as content_factory_ready;
