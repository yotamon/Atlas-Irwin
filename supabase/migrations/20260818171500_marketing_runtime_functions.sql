alter table public.content_items
  add column schedule_local_time time not null default time '18:00',
  add column schedule_timezone text not null default 'Europe/Berlin';

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

  update public.campaigns
  set release_anchor_date = new.release_date
  where release_id = new.id
    and status not in ('completed','archived');

  update public.campaign_phases p
  set starts_at = ((new.release_date + p.relative_start_days)::date + time '00:00') at time zone 'Europe/Berlin',
      ends_at = ((new.release_date + p.relative_end_days + 1)::date + time '00:00') at time zone 'Europe/Berlin'
  from public.campaigns c
  where p.campaign_id = c.id
    and c.release_id = new.id
    and c.status not in ('completed','archived');

  update public.content_items ci
  set scheduled_at = ((new.release_date + ci.relative_day)::date + ci.schedule_local_time) at time zone ci.schedule_timezone
  from public.campaigns c
  where ci.campaign_id = c.id
    and c.release_id = new.id
    and ci.relative_day is not null
    and ci.schedule_locked = false
    and ci.status not in ('Published','Archived');

  return new;
end;
$$;

revoke all on function private.sync_marketing_release_date() from public, anon, authenticated;

drop trigger if exists sync_marketing_release_date on public.releases;
create trigger sync_marketing_release_date
after update of release_date on public.releases
for each row execute function private.sync_marketing_release_date();

create or replace function public.record_attribution_click(
  p_code text,
  p_visitor_hash text,
  p_referrer text default null,
  p_user_agent text default null
)
returns table(destination_url text, link_id uuid, is_unique boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.attribution_links%rowtype;
  seen boolean;
begin
  select * into target
  from public.attribution_links
  where code = p_code and is_active = true
  for update;

  if target.id is null then
    return;
  end if;

  select exists(
    select 1
    from public.attribution_events e
    where e.attribution_link_id = target.id
      and e.visitor_hash = p_visitor_hash
      and e.occurred_at >= now() - interval '30 days'
  ) into seen;

  insert into public.attribution_events(
    owner_id, attribution_link_id, event_type, visitor_hash, referrer, user_agent
  ) values (
    target.owner_id, target.id, 'click', p_visitor_hash, p_referrer, p_user_agent
  );

  update public.attribution_links
  set click_count = click_count + 1,
      unique_click_count = unique_click_count + case when seen then 0 else 1 end,
      last_clicked_at = now()
  where id = target.id;

  return query select target.destination_url, target.id, not seen;
end;
$$;

revoke all on function public.record_attribution_click(text,text,text,text) from public, anon, authenticated;
grant execute on function public.record_attribution_click(text,text,text,text) to service_role;
