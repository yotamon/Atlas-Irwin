begin;

select plan(15);

insert into auth.users (id,email,aud,role,created_at,updated_at)
values ('15000000-0000-0000-0000-000000000001','ops@example.com','authenticated','authenticated',now(),now());
update public.profiles set is_admin=true where id='15000000-0000-0000-0000-000000000001';

delete from public.workspaces where legacy_owner_id='15000000-0000-0000-0000-000000000001';
insert into public.workspaces(id,name,slug,kind,created_by,legacy_owner_id)
values('25000000-0000-0000-0000-000000000001','Ops Workspace','ops-workspace','personal','15000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001');
insert into public.workspace_memberships(workspace_id,profile_id,role,status)
values('25000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','owner','active');
insert into public.artists(id,workspace_id,name,slug,legacy_owner_id)
values
 ('35000000-0000-0000-0000-000000000001','25000000-0000-0000-0000-000000000001','Primary Artist','primary-artist','15000000-0000-0000-0000-000000000001'),
 ('35000000-0000-0000-0000-000000000002','25000000-0000-0000-0000-000000000001','Side Artist','side-artist',null);

insert into public.releases(id,owner_id,artist_id,title,slug,status,release_date)
values
 ('45000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','Primary Release','ops-release','Scheduled',current_date+14),
 ('45000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000002','Side Release','ops-release','Scheduled',current_date+21);

insert into public.campaigns(id,owner_id,release_id,name,status,mode,objective,primary_kpi)
values
 ('55000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000001','Primary Campaign','planned','assisted','Streams','streams'),
 ('55000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000002','Side Campaign','planned','assisted','Streams','streams');

select is((select artist_id from public.campaigns where id='55000000-0000-0000-0000-000000000002'),'35000000-0000-0000-0000-000000000002'::uuid,'campaign inherits its release artist');

insert into public.campaign_phases(owner_id,campaign_id,code,name,objective,relative_start_days,relative_end_days)
values('15000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','launch','Launch','Streams',0,7);
select is((select artist_id from public.campaign_phases where campaign_id='55000000-0000-0000-0000-000000000002' and code='launch'),'35000000-0000-0000-0000-000000000002'::uuid,'campaign descendants inherit campaign artist');

insert into public.content_items(id,owner_id,release_id,campaign_id,title,platform,format,status,goal)
values('65000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000002','55000000-0000-0000-0000-000000000002','Side Reel','Instagram','Reel','Ready','Reach');
select is((select artist_id from public.content_items where id='65000000-0000-0000-0000-000000000002'),'35000000-0000-0000-0000-000000000002'::uuid,'content inherits canonical campaign/release artist');

select throws_ok(
 $$insert into public.content_items(owner_id,artist_id,release_id,campaign_id,title,platform,format,status,goal)
   values('15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000002','55000000-0000-0000-0000-000000000002','Wrong Artist','Instagram','Reel','Draft','Reach')$$,
 'P0001','Content artist must match release artist','cross-artist content lineage fails closed');

insert into public.publication_jobs(id,owner_id,campaign_id,content_item_id,platform,adapter,status,approval_status,request_payload)
values('75000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','65000000-0000-0000-0000-000000000002','Instagram','instagram:first-party','approved','approved','{"caption":"test"}'::jsonb);
select is((select artist_id from public.publication_jobs where id='75000000-0000-0000-0000-000000000002'),'35000000-0000-0000-0000-000000000002'::uuid,'durable publication persists explicit artist scope');
select is((select request_payload->>'artistId' from public.publication_jobs where id='75000000-0000-0000-0000-000000000002'),'35000000-0000-0000-0000-000000000002','publication execution payload carries artist context');

select throws_ok(
 $$insert into public.publication_jobs(owner_id,artist_id,campaign_id,content_item_id,platform,adapter,status,approval_status,request_payload)
   values('15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000002','65000000-0000-0000-0000-000000000002','Instagram','instagram:first-party','approved','approved','{}'::jsonb)$$,
 'P0001','Publication artist must match content artist','service-role-style publication lineage cannot claim a sibling artist');

insert into public.artist_growth_settings(owner_id,artist_id,north_star)
values
 ('15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','Primary growth'),
 ('15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000002','Side growth')
on conflict(artist_id) do update set north_star=excluded.north_star;
select is((select count(*)::integer from public.artist_growth_settings where owner_id='15000000-0000-0000-0000-000000000001'),2,'one owner can keep independent Growth OS settings for two artists');

insert into public.growth_opportunities(owner_id,artist_id,kind,title,rationale,dedupe_key)
values
 ('15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','funnel_bottleneck','Primary signal','Primary evidence','same-key'),
 ('15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000002','funnel_bottleneck','Side signal','Side evidence','same-key');
select is((select count(*)::integer from public.growth_opportunities where dedupe_key='same-key'),2,'growth opportunity dedupe is artist-local');

insert into public.social_channel_accounts(owner_id,artist_id,platform,external_account_id,status)
values
 ('15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','instagram','ig-primary','connected'),
 ('15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000002','instagram','ig-side','connected');
select is((select count(*)::integer from public.social_channel_accounts where owner_id='15000000-0000-0000-0000-000000000001' and platform='instagram'),2,'social connections are independent per artist');

insert into public.metric_snapshots(owner_id,artist_id,date,platform,release_id,streams,listeners)
values
 ('15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001',current_date,'Spotify','45000000-0000-0000-0000-000000000001',100,80),
 ('15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000002',current_date,'Spotify','45000000-0000-0000-0000-000000000002',200,150);
select is((select sum(streams)::integer from public.metric_snapshots where artist_id='35000000-0000-0000-0000-000000000002'),200,'artist metrics aggregate without sibling data');

insert into public.marketing_learnings(owner_id,artist_id,campaign_id,release_id,scope,finding,status)
values
 ('15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000001','campaign','Primary learning','approved'),
 ('15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000002','55000000-0000-0000-0000-000000000002','45000000-0000-0000-0000-000000000002','campaign','Side learning','approved');
select is((select count(*)::integer from public.marketing_learnings where artist_id='35000000-0000-0000-0000-000000000002'),1,'marketing learnings stay local to one artist');

insert into public.marketing_events(owner_id,artist_id,campaign_id,event_type,payload)
values('15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000002','55000000-0000-0000-0000-000000000002','test.event','{}');
insert into public.automation_jobs(owner_id,campaign_id,job_type,payload,status)
select owner_id,campaign_id,'test_job','{}'::jsonb,'queued' from public.marketing_events where event_type='test.event';
select is((select artist_id from public.automation_jobs where job_type='test_job'),'35000000-0000-0000-0000-000000000002'::uuid,'automation job derives explicit artist from campaign/event lineage');
select is((select payload->>'artistId' from public.automation_jobs where job_type='test_job'),'35000000-0000-0000-0000-000000000002','automation payload carries execution artist');

select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is((select count(*)::integer from public.campaigns where artist_id='35000000-0000-0000-0000-000000000002'),1,'workspace member RLS can access the side artist without another profile identity');
reset role;

select * from finish();
rollback;
