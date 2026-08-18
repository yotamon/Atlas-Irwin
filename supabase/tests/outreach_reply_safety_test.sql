begin;

select plan(2);

insert into auth.users (id, email, aud, role, created_at, updated_at)
values (
  '14000000-0000-0000-0000-000000000001',
  'outreach-reply-safety@example.com',
  'authenticated',
  'authenticated',
  now(),
  now()
);

update public.profiles set is_admin = true
where id = '14000000-0000-0000-0000-000000000001';

insert into public.releases (id, owner_id, title, slug, release_date)
values (
  '24000000-0000-0000-0000-000000000001',
  '14000000-0000-0000-0000-000000000001',
  'Outreach Safety Release',
  'outreach-safety-release',
  date '2026-10-01'
);

insert into public.campaigns (
  id, owner_id, release_id, name, status, objective, primary_kpi, release_anchor_date
) values (
  '34000000-0000-0000-0000-000000000001',
  '14000000-0000-0000-0000-000000000001',
  '24000000-0000-0000-0000-000000000001',
  'Outreach Safety Campaign',
  'active',
  'DJ Discovery',
  'selector_action_rate',
  date '2026-10-01'
);

insert into public.outreach_contacts (id, owner_id, name)
values (
  '94000000-0000-0000-0000-000000000001',
  '14000000-0000-0000-0000-000000000001',
  'Reply Safety Selector'
);

insert into public.outreach_sequences (id, owner_id, campaign_id, name, status)
values (
  '94100000-0000-0000-0000-000000000001',
  '14000000-0000-0000-0000-000000000001',
  '34000000-0000-0000-0000-000000000001',
  'Reply safety sequence',
  'active'
);

insert into public.outreach_enrollments (
  id, owner_id, sequence_id, contact_id, campaign_id, status, next_step_order, next_run_at
) values (
  '94200000-0000-0000-0000-000000000001',
  '14000000-0000-0000-0000-000000000001',
  '94100000-0000-0000-0000-000000000001',
  '94000000-0000-0000-0000-000000000001',
  '34000000-0000-0000-0000-000000000001',
  'paused',
  1,
  null
);

insert into public.outreach_messages (
  id, owner_id, contact_id, release_id, campaign_id, sequence_enrollment_id,
  channel, message, sent_at, response_status
) values (
  '94300000-0000-0000-0000-000000000001',
  '14000000-0000-0000-0000-000000000001',
  '94000000-0000-0000-0000-000000000001',
  '24000000-0000-0000-0000-000000000001',
  '34000000-0000-0000-0000-000000000001',
  '94200000-0000-0000-0000-000000000001',
  'Instagram DM',
  'Original message',
  now() - interval '2 days',
  'Sent'
), (
  '94300000-0000-0000-0000-000000000002',
  '14000000-0000-0000-0000-000000000001',
  '94000000-0000-0000-0000-000000000001',
  '24000000-0000-0000-0000-000000000001',
  '34000000-0000-0000-0000-000000000001',
  '94200000-0000-0000-0000-000000000001',
  'Instagram DM',
  'Prepared follow-up that must disappear after reply',
  null,
  'Draft'
);

update public.outreach_messages
set response_status = 'Replied'
where id = '94300000-0000-0000-0000-000000000001';

select is(
  (select status from public.outreach_enrollments where id = '94200000-0000-0000-0000-000000000001'),
  'stopped',
  'reply stops the outreach enrollment'
);

select is(
  (select count(*) from public.outreach_messages where id = '94300000-0000-0000-0000-000000000002'),
  0::bigint,
  'reply removes already-prepared unsent follow-up drafts'
);

select * from finish();

rollback;
