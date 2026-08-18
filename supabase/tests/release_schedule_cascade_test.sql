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

insert into public.releases (id, owner_id, title, slug, release_date)
values (
  '21000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Schedule Cascade Release',
  'schedule-cascade-release',
  date '2026-09-01'
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
  date '2026-09-01',
  date '2026-08-31',
  date '2026-09-03'
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
  timestamptz '2026-08-30 22:00:00+00',
  timestamptz '2026-09-03 22:00:00+00',
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
  timestamptz '2026-09-03 16:00:00+00'
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
  timestamptz '2026-09-03 16:00:00+00'
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
  timestamptz '2026-09-03 16:00:00+00'
);

update public.releases
set release_date = date '2026-09-08'
where id = '21000000-0000-0000-0000-000000000001';

select is(
  (select start_date from public.campaigns where id = '31000000-0000-0000-0000-000000000001'),
  date '2026-09-07',
  'campaign start window follows the earliest relative phase day'
);

select is(
  (select end_date from public.campaigns where id = '31000000-0000-0000-0000-000000000001'),
  date '2026-09-10',
  'campaign end window follows the latest relative phase day'
);

select is(
  (select to_char(scheduled_at at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') from public.content_variants where id = '71000000-0000-0000-0000-000000000001'),
  '2026-09-10 18:00',
  'approved creative variant follows its release-relative content schedule'
);

select is(
  (select to_char(scheduled_at at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI') from public.publication_jobs where id = '81000000-0000-0000-0000-000000000001'),
  '2026-09-10 18:00',
  'queued publication follows the shifted content schedule'
);

select is(
  (select status from public.publication_jobs where id = '81000000-0000-0000-0000-000000000001'),
  'scheduled',
  'a previously manual-ready handoff returns to scheduled when release moves into the future'
);

select * from finish();

rollback;
