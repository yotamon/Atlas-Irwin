begin;

select plan(8);

insert into auth.users (
  id, email, aud, role, created_at, updated_at
) values (
  '12000000-0000-0000-0000-000000000001',
  'stem-intelligence-test@example.com',
  'authenticated',
  'authenticated',
  now(),
  now()
);

update public.profiles
set is_admin = true
where id = '12000000-0000-0000-0000-000000000001';

insert into public.releases (
  id, owner_id, title, slug, release_date
) values (
  '22000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  'Stem Intelligence Test Release',
  'stem-intelligence-test-release',
  date '2026-09-20'
);

insert into public.tracks (
  id, release_id, owner_id, title, duration, audio_url, is_primary
) values (
  '32000000-0000-0000-0000-000000000001',
  '22000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  'Stem Intelligence Test Track',
  180,
  'https://example.com/master-v1.wav',
  true
);

insert into public.media_assets (
  id, owner_id, bucket_name, storage_path, public_url, asset_type, mime_type,
  file_size, visibility, metadata
) values (
  '42000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  'public-media',
  'stem-test/drums.wav',
  'https://example.com/drums.wav',
  'stem',
  'audio/wav',
  1000,
  'public',
  '{}'::jsonb
);

insert into public.track_stems (
  id, owner_id, track_id, media_asset_id, source_provider, category, label,
  status, source_master_url, analysis, alignment, user_overrides
) values (
  '52000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001',
  '42000000-0000-0000-0000-000000000001',
  'suno',
  'drums',
  'Drums',
  'ready',
  'https://example.com/master-v1.wav',
  '{"summary":{"energy":0.8,"groove_score":0.9}}'::jsonb,
  '{"method":"onset_cross_correlation"}'::jsonb,
  '{}'::jsonb
);

insert into public.audio_scenes (
  id, owner_id, track_id, name, scene_type, source, status, recipe,
  objective_tags, platform_hints, recommended_start_ms, recommended_end_ms,
  score, stem_set_fingerprint
) values (
  '62000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001',
  'Groove',
  'groove',
  'system',
  'ready',
  '{"schema":"atlas.audio_scene.v1","layers":[{"source":"stem","stem_id":"52000000-0000-0000-0000-000000000001","gain_db":0}]}'::jsonb,
  array['groove','dance'],
  array['reel','tiktok'],
  12000,
  27000,
  0.92,
  'fixture-fingerprint'
);

insert into public.track_stem_jobs (
  id, owner_id, track_id, stem_id, job_type, status, idempotency_key,
  request_payload
) values (
  '72000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001',
  'analyze_stem',
  'planned',
  'stem-intelligence-db-fixture',
  '{"source_master_url":"https://example.com/master-v1.wav"}'::jsonb
);

select is(
  (select source_master_url from public.track_stems where id = '52000000-0000-0000-0000-000000000001'),
  'https://example.com/master-v1.wav',
  'stem is explicitly bound to the canonical master URL'
);

select is(
  (select status from public.track_stems where id = '52000000-0000-0000-0000-000000000001'),
  'ready',
  'ready stem can exist for the exact current master'
);

select is(
  (select status from public.audio_scenes where id = '62000000-0000-0000-0000-000000000001'),
  'ready',
  'Audio Scene can be ready while its stem set is current'
);

select is(
  (select status from public.track_stem_jobs where id = '72000000-0000-0000-0000-000000000001'),
  'planned',
  'stem job is durable before worker dispatch'
);

update public.tracks
set audio_url = 'https://example.com/master-v2.wav'
where id = '32000000-0000-0000-0000-000000000001';

select is(
  (select status from public.track_stems where id = '52000000-0000-0000-0000-000000000001'),
  'stale',
  'replacing the canonical master makes the old stem binding stale'
);

select is(
  (select status from public.audio_scenes where id = '62000000-0000-0000-0000-000000000001'),
  'stale',
  'replacing the canonical master invalidates derived Audio Scenes'
);

select is(
  (select preview_asset_id from public.audio_scenes where id = '62000000-0000-0000-0000-000000000001'),
  null::uuid,
  'master replacement clears derived Audio Scene preview lineage'
);

select is(
  (select status from public.track_stem_jobs where id = '72000000-0000-0000-0000-000000000001'),
  'cancelled',
  'master replacement cancels non-terminal Stem Intelligence jobs'
);

select * from finish();
rollback;
