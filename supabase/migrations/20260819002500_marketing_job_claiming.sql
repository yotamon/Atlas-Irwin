create or replace function public.claim_marketing_automation_jobs(p_limit integer default 20)
returns setof public.automation_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select j.id
    from public.automation_jobs j
    where j.status = 'queued'
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
    returning j.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_marketing_automation_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_marketing_automation_jobs(integer) to service_role;
