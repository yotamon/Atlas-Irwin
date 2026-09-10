begin;

select plan(15);

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
  (select count(*)::integer from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode in ('audio','lyrics') and state='proposed'),
  2,
  'independent audio and lyric evidence remain durable raw Moment candidates'
);
select is(
  (select count(*)::integer from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='fused' and state='proposed'),
  0,
  'cross-source agreement no longer multiplies artist-facing fused proposals'
);
select is(
  (select concat(source_start_ms,':',source_end_ms) from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='audio'),
  '10000:20000',
  'audio raw evidence keeps canonical Track Intelligence timing'
);
select is(
  (select concat(source_start_ms,':',source_end_ms) from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='lyrics'),
  '12000:18000',
  'lyric raw evidence keeps canonical lyric timing'
);

-- Legacy/provisional fused rows may exist from older recipes. Refresh retires machine proposals rather
-- than deleting them, while approved historical lineage is intentionally preserved.
insert into public.moments(
  owner_id,artist_id,release_id,track_id,start_ms,end_ms,source_start_ms,source_end_ms,
  moment_type,label,source_mode,source_fingerprint,confidence,
  track_analysis_version,track_analysis_audio_sha256,source_candidate_id,lyric_moment_id,lyrics_version,evidence
) values (
  '16000000-0000-0000-0000-000000000001','36000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000001','56000000-0000-0000-0000-000000000001',
  12000,18000,12000,18000,'legacy_fused','Legacy fused proposal','fused','legacy-fused-proposed',0.9,
  3,'execution-sha','hook-exec','67000000-0000-0000-0000-000000000001',1,'{"source_modes":["audio","lyrics"]}'::jsonb
);
select private.refresh_fused_track_moments('56000000-0000-0000-0000-000000000001');
select is(
  (select state::text from public.moments where source_fingerprint='legacy-fused-proposed'),
  'superseded',
  'refresh retires legacy machine-proposed fused rows without deleting history'
);

insert into public.moments(
  owner_id,artist_id,release_id,track_id,start_ms,end_ms,source_start_ms,source_end_ms,
  moment_type,label,source_mode,source_fingerprint,confidence,
  track_analysis_version,track_analysis_audio_sha256,source_candidate_id,lyric_moment_id,lyrics_version,evidence,
  state,reviewed_by,reviewed_at
) values (
  '16000000-0000-0000-0000-000000000001','36000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000001','56000000-0000-0000-0000-000000000001',
  12000,18000,12000,18000,'legacy_fused','Approved legacy fused history','fused','legacy-fused-approved',0.9,
  3,'execution-sha','hook-exec','67000000-0000-0000-0000-000000000001',1,'{"source_modes":["audio","lyrics"]}'::jsonb,
  'approved','16000000-0000-0000-0000-000000000001',now()
);
select private.refresh_fused_track_moments('56000000-0000-0000-0000-000000000001');
select is(
  (select state::text from public.moments where source_fingerprint='legacy-fused-approved'),
  'approved',
  'refresh preserves artist-approved historical fused lineage'
);

-- The application curator chooses a representative raw Moment, adjusts only its effective window when
-- needed, and approval makes that exact canonical window the durable source for downstream execution.
update public.moments
set state='approved', reviewed_by='16000000-0000-0000-0000-000000000001', reviewed_at=now()
where track_id='56000000-0000-0000-0000-000000000001' and source_mode='audio';

insert into public.campaigns(id,owner_id,artist_id,release_id,name)
values ('76000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001','36000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000001','Execution Campaign');

insert into public.content_items(id,owner_id,artist_id,release_id,title,platform,format,moment_id)
select '86000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001','36000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000001','Moment Creative','Instagram','Reel',id
from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='audio' and state='approved';
select is(
  (select concat(audio_timestamp_start,':',audio_timestamp_end) from public.content_items where id='86000000-0000-0000-0000-000000000001'),
  '10:20',
  'attaching an approved canonical Moment captures its exact approved window on new content'
);

select throws_ok(
  $$insert into public.content_items(owner_id,artist_id,release_id,title,platform,format,moment_id)
    select '16000000-0000-0000-0000-000000000001','36000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000002','Wrong Release','Instagram','Reel',id
    from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='audio' and state='approved'$$,
  'P0001','Content release must match Moment release',
  'content cannot attach an approved Moment from another Release'
);

insert into public.campaign_moments(owner_id,artist_id,campaign_id,moment_id,role)
select '16000000-0000-0000-0000-000000000001','36000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000001',id,'primary'
from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='audio' and state='approved';
select is(
  (select count(*)::integer from public.campaign_moments where campaign_id='76000000-0000-0000-0000-000000000001' and is_active),
  1,
  'campaign explicitly references the approved canonical Moment'
);

insert into public.metric_snapshots(owner_id,artist_id,date,platform,release_id,content_item_id,views,saves,follows,link_clicks)
values ('16000000-0000-0000-0000-000000000001','36000000-0000-0000-0000-000000000001',current_date,'Instagram','46000000-0000-0000-0000-000000000001','86000000-0000-0000-0000-000000000001',1000,40,12,31);
select is(
  (select concat(content_items,':',views,':',saves,':',follows,':',link_clicks) from public.moment_performance_rollups where release_id='46000000-0000-0000-0000-000000000001' and moment_id=(select moment_id from public.content_items where id='86000000-0000-0000-0000-000000000001')),
  '1:1000:40:12:31',
  'performance aggregates through content lineage back to the powering Moment'
);

update public.moments set state='superseded'
where track_id='56000000-0000-0000-0000-000000000001' and source_mode='audio';
select is(
  (select is_active from public.campaign_moments where campaign_id='76000000-0000-0000-0000-000000000001'),
  false,
  'superseding a canonical Moment immediately deactivates live campaign usage'
);

select throws_ok(
  $$insert into public.content_items(owner_id,artist_id,release_id,title,platform,format,moment_id)
    select '16000000-0000-0000-0000-000000000001','36000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000001','Stale Creative','Instagram','Reel',id
    from public.moments where track_id='56000000-0000-0000-0000-000000000001' and source_mode='audio'$$,
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
  (select count(*)::integer from public.moments where track_id='56000000-0000-0000-0000-000000000001' and state='superseded'),
  2,
  'superseded raw and legacy fused Moment history is retained rather than deleted'
);

select * from finish();
rollback;
