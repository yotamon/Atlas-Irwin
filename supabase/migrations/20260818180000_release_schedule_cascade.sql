create or replace function private.sync_marketing_release_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.release_date is not distinct from old.release_date then
    return new;
  end if;

  update public.campaigns c
  set release_anchor_date = new.release_date,
      start_date = case
        when new.release_date is null then null
        else new.release_date + coalesce((
          select min(p.relative_start_days)
          from public.campaign_phases p
          where p.campaign_id = c.id
        ), 0)
      end,
      end_date = case
        when new.release_date is null then null
        else new.release_date + coalesce((
          select max(p.relative_end_days)
          from public.campaign_phases p
          where p.campaign_id = c.id
        ), 0)
      end
  where c.release_id = new.id
    and c.status not in ('completed','archived');

  update public.campaign_phases p
  set starts_at = case
        when new.release_date is null then null
        else ((new.release_date + p.relative_start_days)::date + time '00:00') at time zone 'Europe/Berlin'
      end,
      ends_at = case
        when new.release_date is null then null
        else ((new.release_date + p.relative_end_days + 1)::date + time '00:00') at time zone 'Europe/Berlin'
      end
  from public.campaigns c
  where p.campaign_id = c.id
    and c.release_id = new.id
    and c.status not in ('completed','archived');

  update public.content_items ci
  set scheduled_at = case
        when new.release_date is null then null
        else ((new.release_date + ci.relative_day)::date + ci.schedule_local_time) at time zone ci.schedule_timezone
      end
  from public.campaigns c
  where ci.campaign_id = c.id
    and c.release_id = new.id
    and ci.relative_day is not null
    and ci.schedule_locked = false
    and ci.status not in ('Published','Archived');

  update public.content_variants v
  set scheduled_at = ci.scheduled_at
  from public.content_items ci,
       public.campaigns c
  where v.content_item_id = ci.id
    and ci.campaign_id = c.id
    and c.release_id = new.id
    and ci.relative_day is not null
    and ci.schedule_locked = false
    and ci.status not in ('Published','Archived')
    and v.status not in ('published','rejected','archived');

  update public.publication_jobs pj
  set scheduled_at = ci.scheduled_at,
      status = case
        when ci.scheduled_at is not null
             and ci.scheduled_at > now()
             and pj.status in ('approved','manual_ready')
          then 'scheduled'
        else pj.status
      end
  from public.content_items ci,
       public.campaigns c
  where pj.content_item_id = ci.id
    and ci.campaign_id = c.id
    and c.release_id = new.id
    and ci.relative_day is not null
    and ci.schedule_locked = false
    and ci.status not in ('Published','Archived')
    and pj.status not in ('published','failed','cancelled');

  return new;
end;
$$;

revoke all on function private.sync_marketing_release_date() from public, anon, authenticated;
