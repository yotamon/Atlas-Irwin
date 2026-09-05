begin;

select plan(13);

insert into auth.users (
  id, email, aud, role, created_at, updated_at
) values (
  '10000000-0000-0000-0000-000000000001',
  'marketing-engine-test@example.com',
  'authenticated',
  'authenticated',
  now(),
  now()
);

update public.profiles
set is_admin = true
where id = '10000000-0000-0000-0000-000000000001';

insert into public.releases (
  id, owner_id, title, slug, release_date
) values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Campaign Test Release',
  'campaign-test-release',
  date '2026-09-01'
);

insert into public.campaigns (
  id, owner_id, release_id, name, status, objective, primary_kpi, release_anchor_date
) values (
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'Campaign Test',
  'active',
  'Streams',
  'link_click_rate',
  date '2026-09-01'
);

insert into public.campaign_phases (
  id, owner_id, campaign_id, code, name, objective,
  relative_start_days, relative_end_days, starts_at, ends_at, sort_order
) values (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'test-phase',
  'Test Phase',
  'Streams',
  -1,
  2,
  timestamptz '2026-08-30 22:00:00+00',
  timestamptz '2026-09-03 22:00:00+00',
  0
);

insert into public.campaign_experiments (
  id, owner_id, campaign_id, phase_id, title, hypothesis, goal, primary_metric,
  minimum_sample, minimum_lift
) values (
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'Tracked link framing',
  'A concrete hook should create more high-intent clicks.',
  'Streams',
  'link_click_rate',
  250,
  0.15
);

insert into public.content_items (
  id, owner_id, release_id, campaign_id, phase_id, experiment_id,
  title, platform, format, status, goal, relative_day, schedule_locked,
  schedule_local_time, schedule_timezone, scheduled_at
) values (
  '60000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  'Tracked Reel',
  'Instagram',
  'Reel',
  'Draft',
  'Streams',
  2,
  false,
  time '18:00',
  'Europe/Berlin',
  timestamptz '2026-09-03 16:00:00+00'
);

insert into public.content_variants (
  id, owner_id, content_item_id, experiment_id, label, hook_text,
  status, approval_status, is_control, attribution_code
) values (
  '70000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  'A',
  'The tracked hook',
  'approved',
  'approved',
  true,
  'marketing-test-code'
);

insert into public.attribution_links (
  id, owner_id, campaign_id, content_item_id, content_variant_id,
  code, platform, destination_url, label
) values (
  '80000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  'marketing-test-code',
  'Instagram',
  'https://example.com/listen',
  'Tracked variant A'
);

update public.releases
set release_date = date '2026-09-08'
where id = '20000000-0000-0000-0000-000000000001';

select is(
  (select release_anchor_date from public.campaigns where id = '30000000-0000-0000-0000-000000000001'),
  date '2026-09-08',
  'release-date changes update the campaign anchor'
);

select is(
  (select (starts_at at time zone 'Europe/Berlin')::date from public.campaign_phases where id = '40000000-0000-0000-0000-000000000001'),
  date '2026-09-07',
  'release-date changes move phase starts by relative day'
);

select is(
  (select (ends_at at time zone 'Europe/Berlin')::date from public.campaign_phases where id = '40000000-0000-0000-0000-000000000001'),
  date '2026-09-11',
  'phase end is exclusive and follows the shifted release date'
);

select is(
  (select (scheduled_at at time zone 'Europe/Berlin')::date from public.content_items where id = '60000000-0000-0000-0000-000000000001'),
  date '2026-09-10',
  'unlocked content remains release-relative after a date change'
);

select is(
  (select (scheduled_at at time zone 'Europe/Berlin')::time from public.content_items where id = '60000000-0000-0000-0000-000000000001'),
  time '18:00',
  'release-date rescheduling preserves the campaign local publish time'
);

select * from public.record_attribution_click(
  'marketing-test-code', 'visitor-a', 'https://example.com/source', 'test-agent'
);
select * from public.record_attribution_click(
  'marketing-test-code', 'visitor-a', 'https://example.com/source', 'test-agent'
);

select is(
  (select click_count from public.attribution_links where id = '80000000-0000-0000-0000-000000000001'),
  2::bigint,
  'all attribution redirects increment raw click count'
);

select is(
  (select unique_click_count from public.attribution_links where id = '80000000-0000-0000-0000-000000000001'),
  0::bigint,
  'sessionless attribution does not infer unique listeners from visitor hashes'
);

select is(
  (select link_clicks from public.metric_snapshots where content_variant_id = '70000000-0000-0000-0000-000000000001' and source = 'attribution'),
  2::bigint,
  'sessionless redirects accumulate aggregate canonical link-click metrics'
);

select * from public.record_attribution_click(
  'marketing-test-code', 'visitor-b', 'https://example.com/source', 'test-agent'
);

select is(
  (select count(*) from public.attribution_events where attribution_link_id = '80000000-0000-0000-0000-000000000001' and visitor_hash is null),
  3::bigint,
  'legacy redirect stores no visitor identity even when callers send hashes'
);

select is(
  (select link_clicks from public.metric_snapshots where content_variant_id = '70000000-0000-0000-0000-000000000001' and source = 'attribution'),
  3::bigint,
  'all sessionless redirects accumulate into the daily experiment snapshot'
);

select is(
  (select count(*) from public.marketing_events where event_type = 'metrics.updated' and payload->>'source' = 'attribution'),
  0::bigint,
  'high-frequency attribution snapshots do not enqueue evaluation events per click'
);

insert into public.metric_snapshots (
  owner_id, date, platform, release_id, content_item_id, campaign_id,
  experiment_id, content_variant_id, source, reach, views
) values (
  '10000000-0000-0000-0000-000000000001',
  current_date,
  'Instagram',
  '20000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  'manual',
  500,
  500
);

select is(
  (select count(*) from public.marketing_events where event_type = 'metrics.updated' and payload->>'source' = 'manual'),
  1::bigint,
  'qualified reach updates emit one durable experiment-evaluation event'
);

insert into public.outreach_contacts (
  id, owner_id, name
) values (
  '90000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Selector Test'
);

insert into public.outreach_sequences (
  id, owner_id, campaign_id, name, status
) values (
  '91000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'Safe selector sequence',
  'active'
);

insert into public.outreach_enrollments (
  id, owner_id, sequence_id, contact_id, campaign_id, status, next_step_order, next_run_at
) values (
  '92000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'active',
  0,
  now()
);

insert into public.outreach_messages (
  owner_id, contact_id, release_id, campaign_id, sequence_enrollment_id,
  channel, message, response_status
) values (
  '10000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  'Instagram DM',
  'Test message',
  'Replied'
);

select is(
  (select status from public.outreach_enrollments where id = '92000000-0000-0000-0000-000000000001'),
  'stopped',
  'a reply automatically stops future outreach sequence steps'
);

select * from finish();

rollback;
