begin;

select plan(3);

insert into auth.users (id, email, aud, role, created_at, updated_at)
values (
  '13000000-0000-0000-0000-000000000001',
  'campaign-state-test@example.com',
  'authenticated',
  'authenticated',
  now(),
  now()
);

update public.profiles set is_admin = true
where id = '13000000-0000-0000-0000-000000000001';

insert into public.releases (id, owner_id, title, slug, release_date)
values (
  '23000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000001',
  'Campaign State Release',
  'campaign-state-release',
  date '2026-09-20'
);

insert into public.campaigns (
  id, owner_id, release_id, name, status, objective, primary_kpi, release_anchor_date
) values (
  '33000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000001',
  'Campaign State',
  'planned',
  'Streams',
  'link_click_rate',
  date '2026-09-20'
);

insert into public.campaign_experiments (
  id, owner_id, campaign_id, title, hypothesis, goal, primary_metric, status
) values (
  '53000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000001',
  '33000000-0000-0000-0000-000000000001',
  'State transition experiment',
  'Publication should start execution state.',
  'Streams',
  'link_click_rate',
  'planned'
);

insert into public.content_items (
  id, owner_id, release_id, campaign_id, experiment_id,
  title, platform, format, status, goal
) values (
  '63000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000001',
  '33000000-0000-0000-0000-000000000001',
  '53000000-0000-0000-0000-000000000001',
  'Published state test',
  'Instagram',
  'Reel',
  'Draft',
  'Streams'
);

update public.content_items
set status = 'Published', published_at = now()
where id = '63000000-0000-0000-0000-000000000001';

select is(
  (select status from public.campaigns where id = '33000000-0000-0000-0000-000000000001'),
  'active',
  'publishing the first campaign content activates the campaign'
);

select is(
  (select status from public.campaign_experiments where id = '53000000-0000-0000-0000-000000000001'),
  'running',
  'publishing experiment content starts the experiment'
);

select is(
  (select count(*) from public.marketing_events where event_type = 'content.published' and entity_id = '63000000-0000-0000-0000-000000000001'),
  1::bigint,
  'publication emits one durable content.published event'
);

select * from finish();

rollback;
