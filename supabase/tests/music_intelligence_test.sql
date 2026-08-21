begin;

select plan(7);

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
  id, release_id, owner_id, title, duration, is_primary
) values (
  '31000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Track Under Analysis',
  180,
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
  analysis
) values (
  '31000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  2,
  'all-in-one-infer',
  'full',
  true,
  jsonb_build_object(
    'version', 2,
    'source', 'worker',
    'duration_ms', 180000,
    'bpm', 122.0,
    'beat_confidence', 0.9,
    'beats_ms', '[]'::jsonb,
    'downbeats_ms', jsonb_build_array(0, 1967, 3934, 5901),
    'sections', jsonb_build_array(
      jsonb_build_object('id','s1','label','Intro','type','intro','start_ms',0,'end_ms',12000,'energy',0.3),
      jsonb_build_object('id','s2','label','Chorus','type','chorus','start_ms',12000,'end_ms',40000,'energy',0.9)
    ),
    'energy_curve', '[]'::jsonb,
    'edit_points', jsonb_build_array(jsonb_build_object('ms',12000,'confidence',0.9,'reason','Chorus')),
    'peaks_ms', jsonb_build_array(18000),
    'hook_candidates', jsonb_build_array(
      jsonb_build_object(
        'id','hook-1','label','Melodic · Chorus','kind','melodic',
        'start_ms',12345,'end_ms',27100,'duration_ms',14755,'target_duration_ms',15000,
        'section_type','chorus','section_label','Chorus','score',0.93,
        'reasons',jsonb_build_array('Recurring material'),
        'metrics',jsonb_build_object(
          'energy',0.9,'energy_lift',0.8,'novelty',0.6,'onset_density',0.7,
          'melodic_salience',0.8,'boundary_fit',1.0,'loopability',0.8,'structure',1.0,'repetition',0.9
        )
      )
    ),
    'social_cuts', jsonb_build_object(
      '6', null,
      '8', null,
      '15', jsonb_build_object(
        'candidate_id','hook-1','start_ms',12345,'end_ms',27100,
        'score',0.93,'kind','melodic','label','Melodic · Chorus'
      ),
      '30', null
    ),
    'analysis', jsonb_build_object(
      'engine','all-in-one-infer','model','default','quality','full',
      'semantic_structure',true,'real_downbeats',true,'warnings','[]'::jsonb
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
  'content items automatically start on the selected music-intelligence cut'
);

select is(
  (select audio_timestamp_end from public.content_items where id = '51000000-0000-0000-0000-000000000001'),
  28,
  'millisecond social-cut end is safely rounded up to Content Lab seconds'
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

insert into public.music_video_worker_jobs (
  id, owner_id, project_id, job_type, status, idempotency_key, request_payload
) values (
  '61000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '41000000-0000-0000-0000-000000000001',
  'analyze_audio',
  'planned',
  'music-intelligence-cache-test',
  jsonb_build_object('audio_url','https://example.com/master.wav')
);

select is(
  (select status from public.music_video_worker_jobs where id = '61000000-0000-0000-0000-000000000001'),
  'completed',
  'a v2 canonical track analysis completes a duplicate analyze job as a cache hit'
);

select is(
  (select result_payload->>'cache_hit' from public.music_video_worker_jobs where id = '61000000-0000-0000-0000-000000000001'),
  'true',
  'cached worker jobs explicitly record that no worker dispatch is required'
);

select is(
  (select (music_map->>'version')::integer from public.music_video_projects where id = '41000000-0000-0000-0000-000000000001'),
  2,
  'cache reuse copies the canonical v2 map into the video project'
);

update public.track_music_intelligence
set analysis = jsonb_set(
  jsonb_set(analysis, '{social_cuts,15,start_ms}', '45000'::jsonb),
  '{social_cuts,15,end_ms}',
  '60000'::jsonb
)
where track_id = '31000000-0000-0000-0000-000000000001';

select is(
  (select audio_timestamp_start from public.content_items where id = '51000000-0000-0000-0000-000000000001'),
  12,
  'later analysis refreshes do not overwrite an already assigned or user-adjustable content window'
);

select * from finish();
rollback;
