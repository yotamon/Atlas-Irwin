-- Production provisioning for Atlas Marketing OS.
-- Run once in the production Supabase project after storing the two secrets in Vault:
--   atlas_marketing_cron_url    = https://atlasirwin.com
--   atlas_marketing_cron_secret = the same value as Vercel CRON_SECRET
--
-- Keep this outside migrations because local/CI databases do not have production Vault secrets.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'atlas-marketing-every-5-min';

select cron.schedule(
  'atlas-marketing-every-5-min',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'atlas_marketing_cron_url'
      limit 1
    ) || '/api/cron/marketing',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'atlas_marketing_cron_secret'
        limit 1
      )
    ),
    timeout_milliseconds := 300000
  );
  $$
);
