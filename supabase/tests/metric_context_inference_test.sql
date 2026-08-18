begin;

select plan(4);

insert into auth.users (id, email, aud, role, created_at, updated_at)
values (
  '12000000-0000-0000-0000-000000000001',
  'metric-context-test@example.com',
  'authenticated',
  'authenticated',
  now(),
  now()
);

update public.profiles set is_admin = true
where id = '12000000-0000-0000-0000-000000000001';

insert into public.releases (id, owner_id, title, slug, release_date)
values (
  '22000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  'Metric Context Release',
  'metric-context-release',
  date '2026-09-12'
);

insert into public.campaigns (
  id, owner_id, release_id, name, status, objective, primary_kpi, release_anchor_date
) values (
  '32000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  '22000000-0000-0000-0000-000000000001',
  'Metric Context Campaign',
  'active',
  'Streams',
  'link_click_rate',
  date '2026-09-12'
);

insert into public.campaign_experiments (
  id, owner_id, campaign_id, title, hypothesis, goal, primary_metric
) values (
  '52000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001',
  'Metric inference',
  'Existing writers should inherit campaign context.',
  'Streams',
  'link_click_rate'
);

insert into public.content_items (
  id, owner_id, release_id, campaign_id, experiment_id, title, platform,
  format, status, goal
) values (
  '62000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  '22000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  'Legacy metric content',
  'Instagram',
  'Reel',
  'Published',
  'Streams'
);

insert into public.metric_snapshots (
  id, owner_id, date, platform, content_item_id, source, reach, views
) values (
  '82000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  current_date,
  'Instagram',
  '62000000-0000-0000-0000-000000000001',
  'legacy-content-writer',
  400,
  400
);

select is(
  (select release_id from public.metric_snapshots where id = '82000000-0000-0000-0000-000000000001'),
  '22000000-0000-0000-0000-000000000001'::uuid,
  'content-level legacy metrics inherit the release'
);

select is(
  (select campaign_id from public.metric_snapshots where id = '82000000-0000-0000-0000-000000000001'),
  '32000000-0000-0000-0000-000000000001'::uuid,
  'content-level legacy metrics inherit the campaign'
);

select is(
  (select experiment_id from public.metric_snapshots where id = '82000000-0000-0000-0000-000000000001'),
  '52000000-0000-0000-0000-000000000001'::uuid,
  'content-level legacy metrics inherit the experiment'
);

insert into public.metric_snapshots (
  id, owner_id, date, platform, release_id, source, streams, listeners
) values (
  '82000000-0000-0000-0000-000000000002',
  '12000000-0000-0000-0000-000000000001',
  current_date,
  'Spotify',
  '22000000-0000-0000-0000-000000000001',
  'legacy-release-writer',
  50,
  40
);

select is(
  (select campaign_id from public.metric_snapshots where id = '82000000-0000-0000-0000-000000000002'),
  '32000000-0000-0000-0000-000000000001'::uuid,
  'release-level platform metrics attach to the active campaign automatically'
);

select * from finish();

rollback;
