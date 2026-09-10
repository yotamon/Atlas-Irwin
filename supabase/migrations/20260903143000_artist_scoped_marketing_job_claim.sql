-- Ensemblis #71: allow manual Studio execution to claim jobs for exactly one Artist.
-- Global cron continues using claim_marketing_automation_jobs(integer); this companion RPC
-- exists so a user-triggered Artist A run can never claim a sibling Artist B job.

create or replace function public.claim_marketing_automation_jobs_for_artist(
  p_artist_id uuid,
  p_limit integer default 20
)
returns setof public.automation_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_artist_id is null then
    raise exception 'artist_id is required to claim artist-scoped marketing automation jobs';
  end if;

  return query
  with due as (
    select j.id
    from public.automation_jobs j
    where j.status = 'queued'
      and j.artist_id = p_artist_id
      and j.run_after <= now()
    order by j.run_after, j.created_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update public.automation_jobs j
    set status = 'running',
        locked_at = now(),
        attempt_count = j.attempt_count + 1
    from due
    where j.id = due.id
      and j.artist_id = p_artist_id
    returning j.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_marketing_automation_jobs_for_artist(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_marketing_automation_jobs_for_artist(uuid, integer) to service_role;
