begin;

select plan(13);

insert into auth.users (id,email,aud,role,created_at,updated_at)
values ('16000000-0000-0000-0000-000000000001','moment-execution@example.com','authenticated','authenticated',now(),now());
update public.profiles set is_admin=true where id='16000000-0000-0000-0000-000000000001';
delete from public.workspaces where legacy_owner_id='16000000-0000-0000-0000-000000000001';
insert into public.workspaces(id,name,slug,kind,created_by,legacy_owner_id)
values ('26000000-0000-0000-0000-000000000001','Execution Workspace','execution-workspace','personal','16000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001');
insert into public.workspace_memberships(workspace_id,profile_id,role,status)
values ('26000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001','owner','active');
insert into public.artists(id,workspace_id,name,slug,legacy_owner_id)
values ('36000000-0000-0000-0000-000000000001','26000000-0000-0000-0000-000000000001','Execution Artist','execution-artist','16000000-0000-0000-0000-000000000001');

insert into public.releases(id,owner_id,artist_id,title,slug)
values
 ('46000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001','36000000-0000-0000-0000-000000000001','Execution Release','execution-release'),
 ('46000000-0000-0000-0000-000000000002','16000000-0000-0000-0000-000000000001','36000000-0000-0000-0000-000000000001','Other Release','other-release');
insert into public.tracks(id,release_id,owner_id,title,duration,audio_url)
values ('56000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001','Execution Track',120,'https://example.com/execution.wav');

insert into public.track_music_intelligence(
  track_id,owner_id,analysis_version,engine,quality,semantic_structure,source_audio_url,audio_sha256,analysis
) values (
  '56000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001',3,'test','full',true,
  'https://example.com/execution.wav','execution-sha',
  '{"source":"worker","version":3,"hook_candidates":[{"id":"hook-exec","start_ms":10000,"end_ms":20000,"kind":"instant_hook","label":"Execution Hook","score":0.82,"metrics":{"energy":0.74,"novelty":0.64},"intent_scores":{"instant_hook":0.9}}]}'::jsonb
);
insert into public.track_lyrics(id,owner_id,track_id,status,canonical_text)
values ('66000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001','56000000-0000-0000-0000-000000000001','verified','Canonical lyric stays in lyrics intelligence');
insert into public.track_lyric_moments(
  id,lyrics_id,owner_id,track_id,lyrics_version,title,excerpt,interpretation,purpose_tags,score,start_ms,end_ms,timing_source,source_audio_url,music_analysis_version
) values (
  '67000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001','56000000-0000-0000-0000-000000000001',1,
  'Execution lyric','Canonical lyric','Same payoff expressed in words',array['emotional_hook'],0.86,12000,18000,'manual','https://example.com/execution.wav',3
);

select is(
  (select count(*)::integer from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='fused' and state='proposed'),
  1,
  'overlapping independent audio and lyric evidence automatically materializes a fused Moment'
);
select is(
  (select concat(source_start_ms,':',source_end_ms) from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='fused'),
  '12000:18000',
  'fused source timing is the shared evidence intersection'
);
select ok(
  (select source_candidate_id is not null and lyric_moment_id is not null from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='fused'),
  'fused Moment keeps both canonical source references'
);
select ok(
  (select confidence > 0.84 from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='fused'),
  'agreement produces a confidence lift over the average individual evidence'
);

update public.moments
set state='approved', reviewed_by='16000000-0000-0000-0000-000000000001', reviewed_at=now()
where track_id='56000000-0000-0000-0000-000000000001' and source_mode='fused';

insert into public.campaigns(id,owner_id,release_id,name)
values ('76000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000001','Execution Campaign');

insert into public.content_items(id,owner_id,release_id,title,platform,format,moment_id)
select '86000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000001','Moment Creative','Instagram','Reel',id
from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='fused';
select is(
  (select concat(audio_timestamp_start,':',audio_timestamp_end) from public.content_items where id='86000000-0000-0000-0000-000000000001'),
  '12:18',
  'attaching an approved Moment captures its exact approved window on new content'
);

select throws_ok(
  $$insert into public.content_items(owner_id,release_id,title,platform,format,moment_id)
    select '16000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000002','Wrong Release','Instagram','Reel',id
    from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='fused'$$,
  'P0001','Content release must match Moment release',
  'content cannot attach an approved Moment from another Release'
);

insert into public.campaign_moments(owner_id,campaign_id,moment_id,role)
select '16000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000001',id,'primary'
from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='fused';
select is(
  (select count(*)::integer from public.campaign_moments where campaign_id='76000000-0000-0000-0000-000000000001' and is_active),
  1,
  'campaign explicitly references the approved Moment'
);

insert into public.metric_snapshots(owner_id,date,platform,release_id,content_item_id,views,saves,follows,link_clicks)
values ('16000000-0000-0000-0000-000000000001',current_date,'Instagram','46000000-0000-0000-0000-000000000001','86000000-0000-0000-0000-000000000001',1000,40,12,31);
select is(
  (select concat(content_items,':',views,':',saves,':',follows,':',link_clicks) from public.moment_performance_rollups where release_id='46000000-0000-0000-0000-000000000001' and moment_id=(select moment_id from public.content_items where id='86000000-0000-0000-0000-000000000001')),
  '1:1000:40:12:31',
  'performance aggregates through content lineage back to the powering Moment'
);

update public.moments set state='superseded'
where track_id='56000000-0000-0000-0000-000000000001' and source_mode='fused';
select is(
  (select is_active from public.campaign_moments where campaign_id='76000000-0000-0000-0000-000000000001'),
  false,
  'superseding a Moment immediately deactivates live campaign usage'
);

select throws_ok(
  $$insert into public.content_items(owner_id,release_id,title,platform,format,moment_id)
    select '16000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000001','Stale Creative','Instagram','Reel',id
    from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='fused'$$,
  'P0001','Content may only originate from an approved Moment',
  'superseded Moments cannot start new content execution'
);

update public.content_items set caption='Historical creative remains editable'
where id='86000000-0000-0000-0000-000000000001';
select is(
  (select caption from public.content_items where id='86000000-0000-0000-0000-000000000001'),
  'Historical creative remains editable',
  'existing content remains editable after its Moment becomes historical'
);

select throws_ok(
  $$update public.campaign_moments set is_active=true where campaign_id='76000000-0000-0000-0000-000000000001'$$,
  'P0001','Campaigns may only use approved Moments',
  'historical Moment campaign usage cannot be reactivated'
);

select is(
  (select count(*)::integer from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='fused'),
  1,
  'superseded fused Moment history is retained rather than deleted'
);

select * from finish();
rollback;
