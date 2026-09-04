begin;

select plan(21);

insert into auth.users (id,email,aud,role,created_at,updated_at)
values ('17000000-0000-0000-0000-000000000001','closed-loop@example.com','authenticated','authenticated',now(),now());
update public.profiles set is_admin=true where id='17000000-0000-0000-0000-000000000001';
delete from public.workspaces where legacy_owner_id='17000000-0000-0000-0000-000000000001';
insert into public.workspaces(id,name,slug,kind,created_by,legacy_owner_id)
values ('27000000-0000-0000-0000-000000000001','Learning Workspace','learning-workspace','personal','17000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001');
insert into public.workspace_memberships(workspace_id,profile_id,role,status)
values ('27000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001','owner','active');
insert into public.artists(id,workspace_id,name,slug,legacy_owner_id)
values
 ('37000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000001','Learning Artist','learning-artist','17000000-0000-0000-0000-000000000001'),
 ('37000000-0000-0000-0000-000000000002','27000000-0000-0000-0000-000000000001','Other Artist','other-learning-artist',null);

insert into public.releases(id,owner_id,artist_id,title,slug)
values ('47000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','Learning Release','learning-release');
insert into public.tracks(id,release_id,owner_id,title,duration,audio_url)
values ('57000000-0000-0000-0000-000000000001','47000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001','Learning Track',180,'https://example.com/learning.wav');
insert into public.track_music_intelligence(
  track_id,owner_id,analysis_version,engine,quality,semantic_structure,source_audio_url,audio_sha256,analysis
) values (
  '57000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001',1,'test','full',true,
  'https://example.com/learning.wav','learning-sha','{}'::jsonb
);

-- Two approved candidates deliberately start with the high-vocal Moment ahead on
-- the base score. Their pure-audio fingerprints are derived from the canonical
-- Track Intelligence source exactly as production Moments require.
insert into public.moments(
  id,owner_id,artist_id,release_id,track_id,start_ms,end_ms,source_start_ms,source_end_ms,
  moment_type,label,source_mode,source_candidate_id,track_analysis_version,source_fingerprint,purpose_tags,
  energy_score,hook_score,emotional_score,vocal_score,uniqueness_score,confidence,state
) values
 (
  '67000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001',
  '47000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000001',10000,18000,10000,18000,
  'hook','High vocal Moment','audio','closed-loop-high',1,
  encode(digest(concat_ws('|','audio','57000000-0000-0000-0000-000000000001','1','learning-sha','closed-loop-high','10000','18000'),'sha256'),'hex'),
  array['short_form_hook'],0.70,0.80,0.70,0.90,0.70,0.90,'approved'
 ),
 (
  '67000000-0000-0000-0000-000000000002','17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001',
  '47000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000001',30000,39000,30000,39000,
  'hook','Low vocal Moment','audio','closed-loop-low',1,
  encode(digest(concat_ws('|','audio','57000000-0000-0000-0000-000000000001','1','learning-sha','closed-loop-low','30000','39000'),'sha256'),'hex'),
  array['short_form_hook'],0.70,0.80,0.70,0.10,0.70,0.80,'approved'
 );

insert into public.campaigns(id,owner_id,artist_id,release_id,name)
values ('77000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','47000000-0000-0000-0000-000000000001','Learning Campaign');

insert into public.content_items(
  id,owner_id,artist_id,release_id,campaign_id,title,platform,format,goal,source
) values (
  '87000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001',
  '47000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001','Automatic Moment choice','Instagram','Reel','Saves','planner'
);

select is(
  (select moment_id from public.content_items where id='87000000-0000-0000-0000-000000000001'),
  '67000000-0000-0000-0000-000000000001'::uuid,
  'generated content deterministically starts from the strongest approved Moment'
);
select is(
  (select concat(audio_timestamp_start,':',audio_timestamp_end,':',audio_timestamp_source) from public.content_items where id='87000000-0000-0000-0000-000000000001'),
  '10:18:moment',
  'automatic Moment selection snapshots the exact approved window before generic audio selection'
);
select is(
  (select count(*)::integer from public.campaign_moments where campaign_id='77000000-0000-0000-0000-000000000001' and moment_id='67000000-0000-0000-0000-000000000001' and is_active),
  1,
  'generated Moment execution is automatically retained on the campaign lineage'
);

insert into public.content_items(id,owner_id,artist_id,release_id,campaign_id,title,platform,format,goal,source,moment_id)
values
 ('87000000-0000-0000-0000-000000000011','17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','47000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001','High A','Instagram','Reel','Saves','planner','67000000-0000-0000-0000-000000000001'),
 ('87000000-0000-0000-0000-000000000012','17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','47000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001','High B','Instagram','Reel','Saves','planner','67000000-0000-0000-0000-000000000001'),
 ('87000000-0000-0000-0000-000000000013','17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','47000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001','Low A','Instagram','Reel','Saves','planner','67000000-0000-0000-0000-000000000002'),
 ('87000000-0000-0000-0000-000000000014','17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','47000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001','Low B','Instagram','Reel','Saves','planner','67000000-0000-0000-0000-000000000002');

insert into public.metric_snapshots(owner_id,artist_id,date,platform,release_id,content_item_id,views,saves,source,external_object_id,captured_at)
values ('17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001',current_date,'Instagram','47000000-0000-0000-0000-000000000001','87000000-0000-0000-0000-000000000011',5000,4999,'manual','manual-ignored',now());

select is((select count(*)::integer from public.verified_moment_learning_evidence where metric_source='manual'),0,'manual metrics are visible to analytics but never enter automatic learning evidence');
select is((select count(*)::integer from public.marketing_learnings where source='performance'),0,'manual-only evidence cannot manufacture a learning proposal');

insert into public.metric_snapshots(owner_id,artist_id,date,platform,release_id,content_item_id,views,saves,source,captured_at)
values ('17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001',current_date,'Instagram','47000000-0000-0000-0000-000000000001','87000000-0000-0000-0000-000000000012',5000,4999,'instagram_api',now());
select is((select count(*)::integer from public.verified_moment_learning_evidence where content_item_id='87000000-0000-0000-0000-000000000012'),0,'provider-labelled metrics without a provider object id are still untrusted');

insert into public.metric_snapshots(owner_id,artist_id,date,platform,release_id,content_item_id,views,saves,likes,comments,shares,source,external_object_id,captured_at)
values
 ('17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001',current_date,'Instagram','47000000-0000-0000-0000-000000000001','87000000-0000-0000-0000-000000000011',1000,100,40,10,20,'instagram_api','ig-high-a',now()),
 ('17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001',current_date,'Instagram','47000000-0000-0000-0000-000000000001','87000000-0000-0000-0000-000000000012',1000,100,40,10,20,'instagram_api','ig-high-b',now()),
 ('17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001',current_date,'Instagram','47000000-0000-0000-0000-000000000001','87000000-0000-0000-0000-000000000013',1000,20,20,5,5,'instagram_api','ig-low-a',now()),
 ('17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001',current_date,'Instagram','47000000-0000-0000-0000-000000000001','87000000-0000-0000-0000-000000000014',1000,20,20,5,5,'instagram_api','ig-low-b',now());

select is((select count(*)::integer from public.verified_moment_learning_evidence where artist_id='37000000-0000-0000-0000-000000000001'),4,'only explicit Moment to content to provider metric lineage reaches the trusted evidence view');
select is((select status from public.marketing_learnings where learning_key='moment-trait:v1:instagram:vocal_score:save_rate:higher'),'proposed','verified cohort performance creates a reviewable proposal instead of silently changing behavior');
select ok((select evidence_sample_size=4000 and confidence>0.55 and expires_at>now() from public.marketing_learnings where learning_key='moment-trait:v1:instagram:vocal_score:save_rate:higher'),'the proposal carries sample size, confidence and evidence expiry');
select ok((select private.is_valid_marketing_learning_effect(effect) from public.marketing_learnings where learning_key='moment-trait:v1:instagram:vocal_score:save_rate:higher'),'automatic proposals contain only a whitelisted structured decision effect');
select is(private.refresh_moment_performance_learnings('17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000002'),0,'learning refresh is artist-scoped and cannot borrow another artist evidence');

select ok(
  private.moment_execution_score('67000000-0000-0000-0000-000000000001','Instagram','Reel','Saves') >
  private.moment_execution_score('67000000-0000-0000-0000-000000000002','Instagram','Reel','Saves'),
  'a merely proposed learning has no effect on future Moment ranking'
);
select is(private.is_valid_marketing_learning_effect('{"kind":"prompt_injection","weight":1}'::jsonb),false,'unknown learning effects are not executable');

insert into public.marketing_learnings(
  id,owner_id,artist_id,scope,finding,evidence,confidence,status,applies_to,source,
  learning_key,learning_family_key,effect,evidence_sample_size,last_evidence_at,expires_at
) values (
  '97000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001',
  'moment','Lower-vocal Moments are the approved test preference.','{}',1,'proposed','{"platform":"Instagram"}','performance',
  'test:instagram:vocal_score:save_rate:lower','moment-trait:v1:instagram:vocal_score:save_rate',
  '{"kind":"moment_trait_preference","trait":"vocal_score","direction":"lower","weight":0.30,"platform":"Instagram","metric":"save_rate"}',1000,now(),now()+interval '90 days'
);
update public.marketing_learnings set status='approved' where id='97000000-0000-0000-0000-000000000001';

select ok(
  private.moment_execution_score('67000000-0000-0000-0000-000000000002','Instagram','Reel','Saves') >
  private.moment_execution_score('67000000-0000-0000-0000-000000000001','Instagram','Reel','Saves'),
  'human approval activates the structured effect and can change future Moment ranking'
);

insert into public.content_items(id,owner_id,artist_id,release_id,campaign_id,title,platform,format,goal,source)
values ('87000000-0000-0000-0000-000000000002','17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','47000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001','Learned Moment choice','Instagram','Reel','Saves','planner');
select is((select moment_id from public.content_items where id='87000000-0000-0000-0000-000000000002'),'67000000-0000-0000-0000-000000000002'::uuid,'the next generated creative uses the newly approved learning through the deterministic selector');

update public.marketing_learnings set status='approved' where learning_key='moment-trait:v1:instagram:vocal_score:save_rate:higher';
select is((select status from public.marketing_learnings where id='97000000-0000-0000-0000-000000000001'),'superseded','approving an opposite conclusion supersedes the older approved rule in the same family');
select is((select supersedes_learning_id from public.marketing_learnings where learning_key='moment-trait:v1:instagram:vocal_score:save_rate:higher'),'97000000-0000-0000-0000-000000000001'::uuid,'the replacement learning retains explicit supersession lineage');
select ok(
  private.moment_execution_score('67000000-0000-0000-0000-000000000001','Instagram','Reel','Saves') >
  private.moment_execution_score('67000000-0000-0000-0000-000000000002','Instagram','Reel','Saves'),
  'the newly approved evidence-backed direction replaces the prior ranking influence'
);

create temporary table approved_learning_snapshot as
select effect,evidence,confidence,evidence_sample_size,evidence_window_start,evidence_window_end,last_evidence_at,expires_at
from public.marketing_learnings
where learning_key='moment-trait:v1:instagram:vocal_score:save_rate:higher';
insert into public.metric_snapshots(owner_id,artist_id,date,platform,release_id,content_item_id,views,saves,source,external_object_id,captured_at)
values ('17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001',current_date,'Instagram','47000000-0000-0000-0000-000000000001','87000000-0000-0000-0000-000000000011',1500,120,'instagram_api','ig-high-a-refresh',now()+interval '1 second');
select ok(
  (select ml.effect=s.effect and ml.evidence=s.evidence and ml.confidence=s.confidence
          and ml.evidence_sample_size=s.evidence_sample_size
          and ml.evidence_window_start is not distinct from s.evidence_window_start
          and ml.evidence_window_end is not distinct from s.evidence_window_end
          and ml.last_evidence_at is not distinct from s.last_evidence_at
          and ml.expires_at is not distinct from s.expires_at
   from public.marketing_learnings ml cross join approved_learning_snapshot s
   where ml.learning_key='moment-trait:v1:instagram:vocal_score:save_rate:higher'),
  'provider refreshes cannot silently mutate a human-approved evidence/effect snapshot'
);

select throws_ok(
  $$insert into public.marketing_learnings(owner_id,artist_id,scope,finding,evidence,confidence,status,applies_to,source,learning_key,learning_family_key,effect,last_evidence_at,expires_at)
    values ('17000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','moment','Stale evidence','{}',0.9,'approved','{}','performance','test:expired','test:expired-family','{"kind":"moment_trait_preference","trait":"hook_score","direction":"higher","weight":0.2,"metric":"save_rate"}',now()-interval '10 days',now()-interval '1 day')$$,
  'P0001','Expired learning evidence cannot become an active decision rule',
  'expired evidence cannot be approved into the active decision path'
);
select is((select count(*)::integer from public.marketing_learnings where artist_id='37000000-0000-0000-0000-000000000002'),0,'no learning rows leak into another artist scope');

select * from finish();
rollback;
