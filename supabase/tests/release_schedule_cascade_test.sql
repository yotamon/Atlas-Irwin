begin;

select plan(5);

insert into auth.users (id, email, aud, role, created_at, updated_at)
values (
  '11000000-0000-0000-0000-000000000001',
  'schedule-cascade-test@example.com',
  'authenticated',
  'authenticated',
  now(),
  now()
);

update public.profiles set is_admin = true
where id = '11000000-0000-0000-0000-000000000001';

-- Keep the schedule fixtures relative to current_date so the "moves into the future"
-- assertion remains valid regardless of when the test suite runs.
insert into public.releases (id, owner_id, title, slug, release_date)
values (
  '21000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Schedule Cascade Release',
  'schedule-cascade-release',
  current_date - 7
);

insert into public.campaigns (
  id, owner_id, release_id, name, status, objective, primary_kpi,
  release_anchor_date, start_date, end_date
) values (
  '31000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  'Schedule Cascade Campaign',
  'active',
  'Streams',
  'link_click_rate',
  current_date - 7,
  current_date - 8,
  current_date - 5
);

insert into public.campaign_phases (
  id, owner_id, campaign_id, code, name, objective,
  relative_start_days, relative_end_days, starts_at, ends_at, sort_order
) values (
  '41000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001',
  'cascade',
  'Cascade',
  'Streams',
  -1,
  2,
  ((current_date - 8)::date + time '00:00') at time zone 'Europe/Berlin',
  ((current_date - 4)::date + time '00:00') at time zone 'Europe/Berlin',
  0
);

insert into public.content_items (
  id, owner_id, release_id, campaign_id, phase_id, title, platform, format,
  status, goal, relative_day, schedule_locked, schedule_local_time,
  schedule_timezone, scheduled_at
) values (
  '61000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001',
  '41000000-0000-0000-0000-000000000001',
  'Queued Reel',
  'Instagram',
  'Reel',
  'Scheduled',
  'Streams',
  2,
  false,
  time '18:00',
  'Europe/Berlin',
  ((current_date - 5)::date + time '18:00') at time zone 'Europe/Berlin'
);

insert into public.content_variants (
  id, owner_id, content_item_id, label, status, approval_status,
  is_control, scheduled_at
) values (
  '71000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '61000000-0000-0000-0000-000000000001',
  'A',
  'approved',
  'approved',
  true,
  ((current_date - 5)::date + time '18:00') at time zone 'Europe/Berlin'
);

insert into public.publication_jobs (
  id, owner_id, campaign_id, content_item_id, content_variant_id,
  platform, adapter, status, requires_approval, approval_status, scheduled_at
) values (
  '81000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001',
  '61000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  'Instagram',
  'manual:instagram',
  'manual_ready',
  true,
  'approved',
  ((current_date - 5)::date + time '18:00') at time zone 'Europe/Berlin'
);

update public.releases
set release_date = current_date + 14
where id = '21000000-0000-0000-0000-000000000001';

select is(
  (select start_date from public.campaigns where id = '31000000-0000-0000-0000-000000000001'),
  current_date + 13,
  'campaign start window follows the earliest relative phase day'
);

select is(
  (select end_date from public.campaigns where id = '31000000-0000-0000-0000-000000000001'),
  current_date + 16,
  'campaign end window follows the latest relative phase day'
);

select is(
  (select to_char(scheduled_at at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') from public.content_variants where id = '71000000-0000-0000-0000-000000000001'),
  to_char(current_date + 16, 'YYYY-MM-DD') || ' 18:00',
  'approved creative variant follows its release-relative content schedule'
);

select is(
  (select to_char(scheduled_at at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') from public.publication_jobs where id = '81000000-0000-0000-0000-000000000001'),
  to_char(current_date + 16, 'YYYY-MM-DD') || ' 18:00',
  'queued publication follows the shifted content schedule'
);

select is(
  (select status from public.publication_jobs where id = '81000000-0000-0000-0000-000000000001'),
  'scheduled',
  'a previously manual-ready handoff returns to scheduled when release moves into the future'
);

select * from finish();

rollback;
