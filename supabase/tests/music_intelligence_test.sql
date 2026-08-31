begin;

select plan(16);

insert into auth.users (
  id, email, aud, role, created_at, updated_at
) values (
  '11000000-0000-0000-0000-000000000001',
  'music-intelligence-test@example.com',
  'authenticated',
  'authenticated',
  now(),
  now()
);

update public.profiles
set is_admin = true
where id = '11000000-0000-0000-0000-000000000001';

insert into public.releases (
  id, owner_id, title, slug, release_date
) values (
  '21000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Music Intelligence Test Release',
  'music-intelligence-test-release',
  date '2026-09-15'
);

insert into public.tracks (
  id, release_id, owner_id, title, duration, audio_url, is_primary
) values (
  '31000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Track Under Analysis',
  180,
  'https://example.com/master-v3.wav',
  true
);

insert into public.music_video_projects (
  id, owner_id, release_id, track_id, title
) values (
  '41000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001',
  'Cached Video Project'
);

insert into public.track_music_intelligence (
  track_id,
  owner_id,
  analysis_version,
  engine,
  quality,
  semantic_structure,
  source_audio_url,
  audio_sha256,
  analysis_config,
  downbeat_source,
  analysis
) values (
  '31000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  3,
  'all-in-one-infer',
  'full',
  true,
  'https://example.com/master-v3.wav',
  'fixture-sha-v3',
  'atlas-ti-v3.0.0',
  'model',
  jsonb_build_object(
    'version', 3,
    'source', 'worker',
    'source_audio', jsonb_build_object(
      'url','https://example.com/master-v3.wav',
      'audio_sha256','fixture-sha-v3'
    ),
    'duration_ms', 180000,
    'bpm', 122.0,
    'beat_confidence', 0.9,
    'beats_ms', '[]'::jsonb,
    'downbeats_ms', jsonb_build_array(0, 1967, 3934, 5901),
    'downbeat_source', 'model',
    'bars', '[]'::jsonb,
    'phrases', '[]'::jsonb,
    'sections', jsonb_build_array(
      jsonb_build_object('id','s1','label','Intro','type','intro','start_ms',0,'end_ms',12000,'energy',0.3),
      jsonb_build_object('id','s2','label','Chorus','type','chorus','start_ms',12000,'end_ms',40000,'energy',0.9)
    ),
    'energy_curve', '[]'::jsonb,
    'edit_points', jsonb_build_array(jsonb_build_object('ms',12000,'confidence',0.9,'reason','Chorus')),
    'peaks_ms', jsonb_build_array(18000),
    'hook_candidates', jsonb_build_array(
      jsonb_build_object(
        'id','hook-1','label','Musical Identity · Chorus','kind','musical_identity',
        'start_ms',12345,'end_ms',27100,'duration_ms',14755,'target_duration_ms',15000,
        'section_type','chorus','section_label','Chorus','score',0.93,
        'reasons',jsonb_build_array('Recurring material'),
        'metrics',jsonb_build_object(
          'energy',0.9,'energy_lift',0.8,'novelty',0.6,'onset_density',0.7,
          'melodic_salience',0.8,'harmonic_distinctiveness',0.8,
          'boundary_fit',1.0,'loopability',0.8,'boundary_loop_fit',0.8,
          'structure',1.0,'repetition',0.9,'semantic_recurrence',0.9
        )
      )
    ),
    'moments', jsonb_build_object(
      'instant_hook','[]'::jsonb,
      'musical_identity',jsonb_build_array(jsonb_build_object('candidate_id','hook-1','start_ms',12345,'end_ms',27100,'score',0.95,'label','Musical Identity · Chorus')),
      'groove_loop','[]'::jsonb,
      'build_drop','[]'::jsonb,
      'climax','[]'::jsonb,
      'story_arc','[]'::jsonb
    ),
    'social_cuts', jsonb_build_object(
      '6', null,
      '8', null,
      '15', jsonb_build_object(
        'candidate_id','hook-1','start_ms',12345,'end_ms',27100,
        'score',0.93,'kind','musical_identity','label','Musical Identity · Chorus'
      ),
      '30', null
    ),
    'analysis', jsonb_build_object(
      'engine','all-in-one-infer','model','harmonix-all','quality','full',
      'semantic_structure',true,'real_downbeats',true,'downbeat_source','model',
      'config','atlas-ti-v3.0.0','warnings','[]'::jsonb
    )
  )
);

insert into public.content_items (
  id, owner_id, release_id, title, platform, format, status, goal
) values (
  '51000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  'Automatic Reel',
  'Instagram',
  'Reel',
  'Draft',
  'Streams'
);

select is(
  (select audio_timestamp_start from public.content_items where id = '51000000-0000-0000-0000-000000000001'),
  12,
  'v3 content items automatically start on the selected music-intelligence cut'
);

select is(
  (select audio_timestamp_end from public.content_items where id = '51000000-0000-0000-0000-000000000001'),
  28,
  'millisecond v3 social-cut end is safely rounded up to Content Lab seconds'
);

select is(
  (select audio_timestamp_source from public.content_items where id = '51000000-0000-0000-0000-000000000001'),
  'music_intelligence',
  'automatic content timing records its provenance'
);

select is(
  (select audio_timestamp_candidate_id from public.content_items where id = '51000000-0000-0000-0000-000000000001'),
  'hook-1',
  'automatic content timing records the exact candidate lineage'
);

insert into public.content_items (
  id, owner_id, release_id, title, platform, format, status, goal,
  audio_timestamp_start, audio_timestamp_end
) values (
  '51000000-0000-0000-0000-000000000002',
  '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  'Manual Reel',
  'Instagram',
  'Reel',
  'Draft',
  'Streams',
  2,
  6
);

select is(
  (select audio_timestamp_start from public.content_items where id = '51000000-0000-0000-0000-000000000002'),
  2,
  'explicit user audio timing is never replaced on insert'
);

select is(
  (select audio_timestamp_source from public.content_items where id = '51000000-0000-0000-0000-000000000002'),
  'manual',
  'explicit user audio timing is marked manual'
);

insert into public.music_video_worker_jobs (
  id, owner_id, project_id, job_type, status, idempotency_key, request_payload
) values (
  '61000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '41000000-0000-0000-0000-000000000001',
  'analyze_audio',
  'planned',
  'music-intelligence-cache-test-v3',
  jsonb_build_object('audio_url','https://example.com/master-v3.wav')
);

select is(
  (select status from public.music_video_worker_jobs where id = '61000000-0000-0000-0000-000000000001'),
  'completed',
  'an exact-master v3 canonical analysis completes a duplicate analyze job as a cache hit'
);

select is(
  (select result_payload->>'cache_hit' from public.music_video_worker_jobs where id = '61000000-0000-0000-0000-000000000001'),
  'true',
  'cached worker jobs explicitly record that no worker dispatch is required'
);

select is(
  (select (music_map->>'version')::integer from public.music_video_projects where id = '41000000-0000-0000-0000-000000000001'),
  3,
  'cache reuse copies the canonical v3 map into the video project'
);

select is(
  (select downbeat_source from public.track_music_intelligence where track_id = '31000000-0000-0000-0000-000000000001'),
  'model',
  'canonical cache persists downbeat provenance separately from the JSON map'
);

update public.tracks
set audio_url = 'https://example.com/replacement-master.wav'
where id = '31000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::integer from public.track_music_intelligence where track_id = '31000000-0000-0000-0000-000000000001'),
  0,
  'replacing the master invalidates the canonical analysis cache'
);

select is(
  (select audio_timestamp_start from public.content_items where id = '51000000-0000-0000-0000-000000000001'),
  null::integer,
  'replacing the master clears only Atlas-derived content timing'
);

select is(
  (select audio_timestamp_start from public.content_items where id = '51000000-0000-0000-0000-000000000002'),
  2,
  'replacing the master preserves manual content timing'
);

select is(
  (select status::text from public.music_video_projects where id = '41000000-0000-0000-0000-000000000001'),
  'blocked',
  'video production is blocked until the replacement master is re-analyzed'
);

insert into public.track_music_intelligence (
  track_id, owner_id, analysis_version, engine, quality, semantic_structure,
  source_audio_url, audio_sha256, analysis_config, downbeat_source, analysis
) values (
  '31000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  3, 'all-in-one-infer', 'full', true,
  'https://example.com/master-v3.wav', 'stale-sha', 'atlas-ti-v3.0.0', 'model',
  jsonb_build_object(
    'version',3,'source','worker',
    'source_audio',jsonb_build_object('url','https://example.com/master-v3.wav','audio_sha256','stale-sha'),
    'duration_ms',180000,'sections','[]'::jsonb,'energy_curve','[]'::jsonb,
    'social_cuts',jsonb_build_object('15',jsonb_build_object('candidate_id','stale','start_ms',10000,'end_ms',25000,'score',0.9,'kind','instant_hook','label','Stale')),
    'analysis',jsonb_build_object('engine','all-in-one-infer','quality','full','semantic_structure',true,'real_downbeats',true,'downbeat_source','model','warnings','[]'::jsonb)
  )
);

insert into public.music_video_worker_jobs (
  id, owner_id, project_id, job_type, status, idempotency_key, request_payload
) values (
  '61000000-0000-0000-0000-000000000002',
  '11000000-0000-0000-0000-000000000001',
  '41000000-0000-0000-0000-000000000001',
  'analyze_audio','planned','stale-cache-must-not-hit',
  jsonb_build_object('audio_url','https://example.com/replacement-master.wav')
);

select is(
  (select status from public.music_video_worker_jobs where id = '61000000-0000-0000-0000-000000000002'),
  'planned',
  'a v3 analysis from a previous master cannot satisfy a new analyze job'
);

insert into public.content_items (
  id, owner_id, release_id, title, platform, format, status, goal
) values (
  '51000000-0000-0000-0000-000000000003',
  '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  'Replacement Master Reel', 'Instagram', 'Reel', 'Draft', 'Streams'
);

select is(
  (select audio_timestamp_start from public.content_items where id = '51000000-0000-0000-0000-000000000003'),
  null::integer,
  'stale analysis cannot seed Content Lab timing for the replacement master'
);

select * from finish();
rollback;
