begin;

select plan(8);

insert into auth.users (id, email, aud, role, created_at, updated_at)
values ('12000000-0000-0000-0000-000000000001','studio-v2-workflow-test@example.com','authenticated','authenticated',now(),now());

update public.profiles set is_admin = true where id = '12000000-0000-0000-0000-000000000001';

insert into public.releases (id, owner_id, title, slug, release_date)
values ('22000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001','Evidence Release','evidence-release',date '2026-09-20');

insert into public.campaigns (id, owner_id, release_id, name, status, objective, primary_kpi, release_anchor_date)
values ('32000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','Evidence Campaign','active','Streams','link_click_rate',date '2026-09-20');

insert into public.content_items (id, owner_id, release_id, campaign_id, title, platform, format, status, goal)
values ('62000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','Evidence Content','Instagram','Reel','Ready','Reach');

select is((select status from public.content_items where id='62000000-0000-0000-0000-000000000001'),'Draft','content without evidence is Draft even when a caller tries to set a later state');

update public.content_items set caption='A real caption' where id='62000000-0000-0000-0000-000000000001';
select is((select status from public.content_items where id='62000000-0000-0000-0000-000000000001'),'In Production','copy evidence moves content into production automatically');

update public.content_items set asset_url='https://example.com/asset.jpg' where id='62000000-0000-0000-0000-000000000001';
select is((select status from public.content_items where id='62000000-0000-0000-0000-000000000001'),'Ready','asset plus creative evidence makes content Ready automatically');

update public.content_items set scheduled_at=timestamptz '2026-09-19 16:00:00+00' where id='62000000-0000-0000-0000-000000000001';
select is((select status from public.content_items where id='62000000-0000-0000-0000-000000000001'),'Scheduled','a scheduled asset becomes Scheduled automatically');

select is((select count(*)::integer from public.publication_jobs where content_item_id='62000000-0000-0000-0000-000000000001' and status='awaiting_approval' and approval_status='pending'),1,'scheduling a complete item creates exactly one external publication approval');

update public.publication_jobs set status='provider_scheduled', approval_status='approved', external_post_id='provider-schedule-1' where content_item_id='62000000-0000-0000-0000-000000000001' and status='awaiting_approval';
select is((select status from public.publication_jobs where content_item_id='62000000-0000-0000-0000-000000000001' and external_post_id='provider-schedule-1'),'provider_scheduled','connected providers can own exact future scheduling without a frequent Atlas cron');

insert into public.releases (id, owner_id, title, slug, release_date)
values ('22000000-0000-0000-0000-000000000002','12000000-0000-0000-0000-000000000001','Bootstrap Release','bootstrap-release',date '2026-10-01');
insert into public.campaigns (id, owner_id, release_id, name, status, objective, primary_kpi, release_anchor_date)
values ('32000000-0000-0000-0000-000000000002','12000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','Bootstrap Campaign','draft','Streams','link_click_rate',date '2026-10-01');
insert into public.marketing_events (owner_id,campaign_id,event_type,entity_type,entity_id,payload)
values ('12000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000002','release.workspace_created','release','22000000-0000-0000-0000-000000000002','{}'::jsonb);

select is((select count(*)::integer from public.content_items where campaign_id='32000000-0000-0000-0000-000000000002' and source='automation'),5,'a new release workspace receives five free starter content moments');

update public.releases set release_date=date '2026-10-08' where id='22000000-0000-0000-0000-000000000002';
select is((select to_char(scheduled_at at time zone 'Europe/Berlin','YYYY-MM-DD HH24:MI') from public.content_items where campaign_id='32000000-0000-0000-0000-000000000002' and relative_day=0),'2026-10-08 18:00','moving the release date automatically moves unlocked starter content');

select * from finish();
rollback;
