-- Keep the free content factory's database-side HTTP client alive long enough for
-- a first-run persistent Vercel Sandbox bootstrap and deterministic ffmpeg render.
-- The job remains free-composer-only; this changes no spend or publication policy.

do $migration$
declare
  target_job_id bigint;
begin
  select jobid into target_job_id
  from cron.job
  where jobname = 'atlas-content-factory-6-hour'
  limit 1;

  if target_job_id is not null then
    perform cron.alter_job(
      job_id := target_job_id,
      command := $cron$
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
          timeout_milliseconds := 210000
        );
      $cron$
    );
  end if;
end
$migration$;
