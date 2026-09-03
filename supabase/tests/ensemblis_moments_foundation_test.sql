begin;

select plan(24);

insert into auth.users (id, email, aud, role, created_at, updated_at)
values
  ('15000000-0000-0000-0000-000000000001','moments-a@example.com','authenticated','authenticated',now(),now()),
  ('15000000-0000-0000-0000-000000000002','moments-b@example.com','authenticated','authenticated',now(),now());

update public.profiles set is_admin = true
where id in ('15000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000002');

delete from public.workspaces
where legacy_owner_id in ('15000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000002');

insert into public.workspaces(id,name,slug,kind,created_by,legacy_owner_id)
values
  ('25000000-0000-0000-0000-000000000001','Moments A','moments-a','personal','15000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001'),
  ('25000000-0000-0000-0000-000000000002','Moments B','moments-b','personal','15000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000002');
insert into public.workspace_memberships(workspace_id,profile_id,role,status)
values
  ('25000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','owner','active'),
  ('25000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000002','owner','active');
insert into public.artists(id,workspace_id,name,slug,legacy_owner_id)
values
  ('35000000-0000-0000-0000-000000000001','25000000-0000-0000-0000-000000000001','Moment Artist A','moment-artist-a','15000000-0000-0000-0000-000000000001'),
  ('35000000-0000-0000-0000-000000000002','25000000-0000-0000-0000-000000000002','Moment Artist B','moment-artist-b','15000000-0000-0000-0000-000000000002');

insert into public.releases(id,owner_id,artist_id,title,slug)
values
  ('45000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','Moment Release A','moment-release'),
  ('45000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000002','35000000-0000-0000-0000-000000000002','Moment Release B','moment-release');
insert into public.tracks(id,release_id,owner_id,title,duration,audio_url)
values
  ('55000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','Moment Track A',120,'https://example.com/a-v1.wav'),
  ('55000000-0000-0000-0000-000000000002','45000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000002','Moment Track B',120,'https://example.com/b-v1.wav');

insert into public.track_music_intelligence(
  track_id, owner_id, analysis_version, engine, quality, semantic_structure,
  source_audio_url, audio_sha256, analysis
) values (
  '55000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001',3,'test','full',true,
  'https://example.com/a-v1.wav','sha-a-v1',
  '{"source":"worker","version":3,"hook_candidates":[{"id":"hook-1","start_ms":10000,"end_ms":18000,"kind":"instant_hook","label":"Instant Hook · Chorus","score":0.84,"section_type":"chorus","section_label":"Chorus","metrics":{"energy":0.72,"novelty":0.66,"harmonic_distinctiveness":0.61},"intent_scores":{"instant_hook":0.91},"reasons":["Clear payoff"]}]}'::jsonb
);

select is(
  (select count(*)::integer from public.moments where track_id='55000000-0000-0000-0000-000000000001' and source_mode='audio' and state='proposed'),
  1,
  'Track Intelligence automatically materializes one audio Moment proposal'
);
select is(
  (select artist_id from public.moments where track_id='55000000-0000-0000-0000-000000000001' and source_mode='audio'),
  '35000000-0000-0000-0000-000000000001'::uuid,
  'Moment inherits canonical track Artist'
);
select is(
  (select release_id from public.moments where track_id='55000000-0000-0000-0000-000000000001' and source_mode='audio'),
  '45000000-0000-0000-0000-000000000001'::uuid,
  'Moment inherits canonical track Release'
);
select is(
  (select concat(start_ms,':',end_ms,':',source_start_ms,':',source_end_ms) from public.moments where track_id='55000000-0000-0000-0000-000000000001' and source_mode='audio'),
  '10000:18000:10000:18000',
  'initial effective timing exactly matches immutable source timing'
);
select is(
  (select round(hook_score,2) from public.moments where track_id='55000000-0000-0000-0000-000000000001' and source_mode='audio'),
  0.91::numeric,
  'audio Moment keeps purpose-specific hook evidence instead of one generic score'
);

select private.refresh_track_moments('55000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::integer from public.moments where track_id='55000000-0000-0000-0000-000000000001' and source_mode='audio'),
  1,
  're-materializing unchanged evidence is idempotent'
);

update public.moments
set state='approved', start_ms=11000, end_ms=19000, label='Artist-approved hook',
    reviewed_by='15000000-0000-0000-0000-000000000001', reviewed_at=now()
where track_id='55000000-0000-0000-0000-000000000001' and source_mode='audio';
select is(
  (select concat(state::text,':',start_ms,':',source_start_ms) from public.moments where track_id='55000000-0000-0000-0000-000000000001' and source_mode='audio'),
  'approved:11000:10000',
  'artist may edit effective timing without rewriting source provenance'
);

update public.track_music_intelligence
set analysis = '{"source":"worker","version":3,"hook_candidates":[{"id":"hook-1","start_ms":10000,"end_ms":18000,"kind":"instant_hook","label":"Worker changed label","score":0.95,"section_type":"chorus","section_label":"Chorus","metrics":{"energy":0.80,"novelty":0.70},"intent_scores":{"instant_hook":0.97},"reasons":["Updated evidence"]}]}'::jsonb
where track_id='55000000-0000-0000-0000-000000000001';
select is(
  (select concat(state::text,':',label,':',start_ms) from public.moments where track_id='55000000-0000-0000-0000-000000000001' and source_mode='audio'),
  'approved:Artist-approved hook:11000',
  'refresh never overwrites reviewed Moment content when source identity is unchanged'
);

select throws_ok(
  $$insert into public.moments(
      owner_id,artist_id,release_id,track_id,start_ms,end_ms,source_start_ms,source_end_ms,
      moment_type,label,source_mode,source_fingerprint,track_analysis_version,track_analysis_audio_sha256,source_candidate_id,evidence
    ) values (
      '15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001',
      10000,18000,10000,18000,'instant_hook','Tampered','audio','invented-fingerprint',3,'sha-a-v1','hook-1','{}'::jsonb
    )$$,
  'P0001','Moment source fingerprint must match canonical source lineage',
  'pure-source Moments cannot bypass deduplication with an invented fingerprint'
);

insert into public.track_lyrics(id,owner_id,track_id,status,canonical_text)
values ('65000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001','verified','Keep this canonical lyric text only in Lyrics Intelligence');
insert into public.track_lyric_moments(
  id,lyrics_id,owner_id,track_id,lyrics_version,section_key,title,excerpt,interpretation,
  purpose_tags,visual_directions,score,start_ms,end_ms,timing_source,source_audio_url,music_analysis_version
) values (
  '66000000-0000-0000-0000-000000000001','65000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001',1,
  'chorus','Lyric payoff','Keep this canonical lyric text','An intimate release of tension',
  array['emotional_hook'],array['close typography'],0.88,20000,26000,'manual','https://example.com/a-v1.wav',3
);
select is(
  (select count(*)::integer from public.moments where track_id='55000000-0000-0000-0000-000000000001' and source_mode='lyrics' and lyric_moment_id='66000000-0000-0000-0000-000000000001'),
  1,
  'timed Lyrics Intelligence materializes a first-class lyric Moment'
);
select is(
  (select count(*)::integer from information_schema.columns where table_schema='public' and table_name='moments' and column_name='excerpt'),
  0,
  'Moment schema references lyrics instead of duplicating canonical lyric text'
);
select ok(
  not (select evidence ? 'excerpt' from public.moments where lyric_moment_id='66000000-0000-0000-0000-000000000001'),
  'lyric Moment evidence omits the canonical excerpt while preserving semantic provenance'
);

insert into public.audio_scenes(
  id,owner_id,track_id,name,scene_type,status,recipe_version,recipe,objective_tags,platform_hints,
  recommended_start_ms,recommended_end_ms,score,rationale,stem_set_fingerprint
) values (
  '75000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001',
  'Vocal Spotlight','vocal_spotlight','ready',2,'{"stems":["vocals"]}'::jsonb,array['story'],array['reel'],30000,38000,0.81,'{"why":"voice carries identity"}'::jsonb,'stem-set-a'
);
select is(
  (select count(*)::integer from public.moments where track_id='55000000-0000-0000-0000-000000000001' and source_mode='stems' and audio_scene_id='75000000-0000-0000-0000-000000000001'),
  1,
  'ready timed Audio Scene materializes a stem-aware Moment'
);
select ok(
  not (select evidence ? 'recipe' from public.moments where audio_scene_id='75000000-0000-0000-0000-000000000001'),
  'Moment references Audio Scene recipe lineage instead of duplicating the recipe'
);

-- Build a second tenant with real evidence for adversarial lineage/RLS tests.
insert into public.track_music_intelligence(
  track_id,owner_id,analysis_version,engine,quality,semantic_structure,source_audio_url,audio_sha256,analysis
) values (
  '55000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000002',3,'test','full',true,
  'https://example.com/b-v1.wav','sha-b-v1',
  '{"source":"worker","version":3,"hook_candidates":[{"id":"hook-b","start_ms":12000,"end_ms":20000,"kind":"groove_loop","label":"B Groove","score":0.75,"metrics":{"energy":0.6},"intent_scores":{"instant_hook":0.5}}]}'::jsonb
);
insert into public.track_lyrics(id,owner_id,track_id,status,canonical_text)
values ('65000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000002','55000000-0000-0000-0000-000000000002','verified','Beta lyric');
insert into public.track_lyric_moments(
  id,lyrics_id,owner_id,track_id,lyrics_version,title,excerpt,interpretation,score,start_ms,end_ms,timing_source,source_audio_url
) values (
  '66000000-0000-0000-0000-000000000002','65000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000002','55000000-0000-0000-0000-000000000002',1,
  'Beta lyric','Beta lyric','Beta meaning',0.7,22000,28000,'manual','https://example.com/b-v1.wav'
);

select throws_ok(
  $$insert into public.moments(
      owner_id,artist_id,release_id,track_id,start_ms,end_ms,source_start_ms,source_end_ms,
      moment_type,label,source_mode,source_fingerprint,track_analysis_version,track_analysis_audio_sha256,source_candidate_id,
      lyric_moment_id,lyrics_version,evidence
    ) values (
      '15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001',
      10000,28000,10000,28000,'fused','Cross-track fusion','fused','fused-cross-track',3,'sha-a-v1','hook-1',
      '66000000-0000-0000-0000-000000000002',1,'{}'::jsonb
    )$$,
  'P0001','Moment lyric source must belong to the same track/version',
  'a fused Moment cannot claim evidence from another track or Artist'
);

select throws_ok(
  $$insert into public.moments(
      owner_id,artist_id,release_id,track_id,start_ms,end_ms,source_start_ms,source_end_ms,
      moment_type,label,source_mode,source_fingerprint,track_analysis_version,track_analysis_audio_sha256,source_candidate_id,
      lyric_moment_id,lyrics_version,evidence
    ) values (
      '15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001',
      10000,130500,10000,26000,'fused','Too long','fused','fused-too-long',3,'sha-a-v1','hook-1',
      '66000000-0000-0000-0000-000000000001',1,'{}'::jsonb
    )$$,
  'P0001','Moment timing exceeds track duration',
  'effective Moment timing cannot run beyond the track'
);

select throws_ok(
  $$insert into public.moments(
      owner_id,artist_id,release_id,track_id,start_ms,end_ms,source_start_ms,source_end_ms,
      moment_type,label,source_mode,source_fingerprint,track_analysis_version,track_analysis_audio_sha256,source_candidate_id,evidence
    ) values (
      '15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001',
      10000,18000,10000,18000,'fused','Not really fused','fused','fused-one-source',3,'sha-a-v1','hook-1','{}'::jsonb
    )$$,
  'P0001','Fused Moments require at least two independent evidence sources',
  'fused lifecycle cannot be used as a label for single-source evidence'
);

insert into public.moments(
  owner_id,artist_id,release_id,track_id,start_ms,end_ms,source_start_ms,source_end_ms,
  moment_type,label,source_mode,source_fingerprint,track_analysis_version,track_analysis_audio_sha256,source_candidate_id,
  lyric_moment_id,lyrics_version,confidence,evidence
) values (
  '15000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001',
  10000,26000,10000,26000,'fused','Music + lyric payoff','fused','fused-alpha-1',3,'sha-a-v1','hook-1',
  '66000000-0000-0000-0000-000000000001',1,0.9,'{"fusion":"audio+lyrics"}'::jsonb
);
select is(
  (select state::text from public.moments where source_fingerprint='fused-alpha-1'),
  'proposed',
  'valid multi-source fusion is represented as one durable Moment'
);

delete from public.track_lyric_moments where id='66000000-0000-0000-0000-000000000001';
select is(
  (select state::text from public.moments where lyric_moment_id='66000000-0000-0000-0000-000000000001' and source_mode='lyrics'),
  'superseded',
  'deleting refreshed lyric evidence preserves and supersedes the old lyric Moment'
);
select is(
  (select state::text from public.moments where source_fingerprint='fused-alpha-1'),
  'superseded',
  'fused Moment is superseded when any referenced evidence class disappears'
);

update public.tracks set audio_url='https://example.com/a-v2.wav'
where id='55000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::integer from public.moments where track_id='55000000-0000-0000-0000-000000000001' and state in ('proposed','approved')),
  0,
  'canonical master replacement supersedes every timed Moment still active on the old master'
);
select throws_ok(
  $$update public.moments set state='approved' where track_id='55000000-0000-0000-0000-000000000001' and state='superseded'$$,
  'P0001','Rejected or superseded Moments are terminal',
  'superseded Moment history cannot be revived and contaminate future learning'
);

select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is(
  (select count(*)::integer from public.moments where artist_id='35000000-0000-0000-0000-000000000002'),
  0,
  'Moment RLS prevents one workspace from reading another Artist tenant'
);
reset role;

select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is(
  (select count(*)::integer from public.moments where artist_id='35000000-0000-0000-0000-000000000002'),
  2,
  'the owning workspace can read its audio and lyric Moment proposals'
);
reset role;

select * from finish();
rollback;
