-- Keep the free content factory's database-side HTTP client alive long enough for
-- a first-run persistent Vercel Sandbox bootstrap and deterministic ffmpeg render.
-- The job remains free-composer-only; this changes no spend or publication policy.
-- pg_cron is production infrastructure rather than part of clean local database replay,
-- so this migration is intentionally a no-op when the extension is unavailable.

do $migration$
declare
  target_job_id bigint;
  target_command text := $cron$
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
  $cron$;
begin
  if to_regclass('cron.job') is null
    or to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is null then
    return;
  end if;

  execute 'select jobid from cron.job where jobname = $1 limit 1'
    into target_job_id
    using 'atlas-content-factory-6-hour';

  if target_job_id is not null then
    execute 'select cron.alter_job($1, null, $2, null, null, null)'
      using target_job_id, target_command;
  end if;
end
$migration$;
