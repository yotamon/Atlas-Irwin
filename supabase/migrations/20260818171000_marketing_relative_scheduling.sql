alter table public.content_items
  add column relative_day integer,
  add column schedule_locked boolean not null default false;

create index content_campaign_relative_day_idx
  on public.content_items(campaign_id, relative_day)
  where campaign_id is not null and relative_day is not null;
