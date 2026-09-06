begin;

select plan(14);

insert into auth.users (id,email,aud,role,created_at,updated_at)
values ('19000000-0000-0000-0000-000000000001','moment-calibration@example.com','authenticated','authenticated',now(),now());

update public.profiles set is_admin = true
where id = '19000000-0000-0000-0000-000000000001';

delete from public.workspaces
where legacy_owner_id = '19000000-0000-0000-0000-000000000001';

insert into public.workspaces(id,name,slug,kind,created_by,legacy_owner_id)
values ('29000000-0000-0000-0000-000000000001','Calibration Workspace','calibration-workspace','personal','19000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001');
insert into public.workspace_memberships(workspace_id,profile_id,role,status)
values ('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','owner','active');
insert into public.artists(id,workspace_id,name,slug,legacy_owner_id)
values ('39000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','Calibration Artist','calibration-artist','19000000-0000-0000-0000-000000000001');

insert into public.releases(id,owner_id,artist_id,title,slug)
values ('49000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','Calibration Release','calibration-release');
insert into public.tracks(id,release_id,owner_id,title,duration,audio_url)
values ('59000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','Calibration Track',180,'https://example.com/calibration-v1.wav');

insert into public.track_music_intelligence(
  track_id,owner_id,analysis_version,engine,quality,semantic_structure,
  source_audio_url,audio_sha256,analysis
) values (
  '59000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001',4,'test','full',true,
  'https://example.com/calibration-v1.wav','calibration-sha-v1',
  '{"source":"worker","version":4,"hook_candidates":[{"id":"hook-cal-a","start_ms":10000,"end_ms":18000,"kind":"instant_hook","label":"Hook A","score":0.82,"metrics":{"energy":0.72},"intent_scores":{"instant_hook":0.88}},{"id":"hook-cal-b","start_ms":40000,"end_ms":56000,"kind":"groove_loop","label":"Hook B","score":0.80,"metrics":{"energy":0.70},"intent_scores":{"instant_hook":0.75}}]}'::jsonb
);

select is(
  (select count(*)::integer from public.moments where track_id='59000000-0000-0000-0000-000000000001' and state='proposed'),
  2,
  'Track Intelligence materializes two calibration candidates'
);

select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select lives_ok(
  $$select public.review_moment_with_calibration(
    (select id from public.moments where source_candidate_id='hook-cal-a'),
    '49000000-0000-0000-0000-000000000001','approve',11000,20000,'Artist favorite hook',
    'best'::public.moment_calibration_judgment,null,15,null,'{"source":"pgtap"}'::jsonb
  )$$,
  'artist can approve a Moment and append calibration atomically'
);
reset role;

select is(
  (select concat(state::text,':',start_ms,':',end_ms,':',source_start_ms,':',source_end_ms)
   from public.moments where source_candidate_id='hook-cal-a'),
  'approved:11000:20000:10000:18000',
  'artist timing changes effective window without rewriting immutable source timing'
);

select is(
  (select concat(moment_source_fingerprint,':',moment_track_analysis_version,':',moment_track_analysis_audio_sha256,':',preferred_cut_seconds)
   from public.moment_calibration_events e
   join public.moments m on m.id=e.moment_id
   where m.source_candidate_id='hook-cal-a'),
  (select concat(source_fingerprint,':',track_analysis_version,':',track_analysis_audio_sha256,':15)
   from public.moments where source_candidate_id='hook-cal-a'),
  'calibration snapshots exact Moment, analyzer and master provenance'
);

select is(
  (select round(private.moment_calibration_delta(id),2) from public.moments where source_candidate_id='hook-cal-a'),
  0.18::numeric,
  'Best Moment judgment contributes the bounded direct preference boost'
);

select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select lives_ok(
  $$select public.review_moment_with_calibration(
    (select id from public.moments where source_candidate_id='hook-cal-b'),
    '49000000-0000-0000-0000-000000000001','approve',40000,56000,'Useful but second choice',
    'useful'::public.moment_calibration_judgment,'groove support',30,
    (select id from public.moments where source_candidate_id='hook-cal-a'),
    '{"source":"pgtap"}'::jsonb
  )$$,
  'artist can explicitly prefer another active Moment from the same track'
);
reset role;

select is(
  (select round(private.moment_calibration_delta(id),2) from public.moments where source_candidate_id='hook-cal-b'),
  0.02::numeric,
  'Useful source Moment is reduced when the artist explicitly prefers another Moment'
);

select is(
  (select round(private.moment_calibration_delta(id),2) from public.moments where source_candidate_id='hook-cal-a'),
  0.20::numeric,
  'incoming preference plus favorite judgment is capped at the calibration ceiling'
);

select ok(
  not has_table_privilege('authenticated','public.moment_calibration_events','INSERT')
  and not has_table_privilege('authenticated','public.moment_calibration_events','UPDATE')
  and not has_table_privilege('authenticated','public.moment_calibration_events','DELETE'),
  'authenticated clients cannot bypass the review RPC to mutate calibration history'
);

update public.tracks
set audio_url='https://example.com/calibration-v2.wav'
where id='59000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::integer from public.moments where track_id='59000000-0000-0000-0000-000000000001' and state in ('proposed','approved')),
  0,
  'master replacement supersedes calibrated old-Master Moments'
);

select lives_ok(
  $$update public.track_music_intelligence
    set analysis_version=5,
        source_audio_url='https://example.com/calibration-v2.wav',
        audio_sha256='calibration-sha-v2',
        analysis='{"source":"worker","version":5,"hook_candidates":[{"id":"hook-cal-v2","start_ms":12000,"end_ms":30000,"kind":"instant_hook","label":"Fresh Hook","score":0.9,"metrics":{"energy":0.8},"intent_scores":{"instant_hook":0.92}}]}'::jsonb
    where track_id='59000000-0000-0000-0000-000000000001'$$,
  'fresh Track Intelligence can materialize after a master replacement'
);

select is(
  (select count(*)::integer from public.moments where track_id='59000000-0000-0000-0000-000000000001' and state='proposed' and source_candidate_id='hook-cal-v2'),
  1,
  'new master creates a fresh active Moment rather than reviving old lineage'
);

select is(
  (select round(private.moment_calibration_delta(id),2) from public.moments where source_candidate_id='hook-cal-v2'),
  0.00::numeric,
  'old-master calibration contributes nothing to the fresh Moment'
);

select is(
  (select count(*)::integer from public.moment_calibration_events where owner_id='19000000-0000-0000-0000-000000000001'),
  2,
  'calibration history remains durable after the canonical master changes'
);

select * from finish();
rollback;
