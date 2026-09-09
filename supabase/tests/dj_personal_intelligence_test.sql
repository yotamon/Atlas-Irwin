begin;

select plan(18);

select has_table('public', 'dj_profiles', 'DJ profiles table exists');
select has_table('public', 'dj_preference_evidence', 'DJ preference evidence table exists');
select has_column('public', 'dj_profiles', 'explicit_preferences', 'DJ profile keeps explicit preferences separately');
select has_column('public', 'dj_profiles', 'learned_preferences', 'DJ profile keeps learned preferences separately');
select has_column('public', 'dj_preference_evidence', 'evidence_key', 'DJ evidence has a stable idempotency key');
select has_column('public', 'dj_preference_evidence', 'weight', 'DJ evidence has bounded learning weight');

insert into auth.users (id, email, aud, role, created_at, updated_at)
values
  ('16000000-0000-0000-0000-000000000001','dj-a@example.com','authenticated','authenticated',now(),now()),
  ('16000000-0000-0000-0000-000000000002','dj-b@example.com','authenticated','authenticated',now(),now());

update public.profiles
set is_admin = true
where id in (
  '16000000-0000-0000-0000-000000000001',
  '16000000-0000-0000-0000-000000000002'
);

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
set local role authenticated;

insert into public.dj_profiles (
  owner_id,
  artist_id,
  explicit_preferences,
  learned_preferences,
  learned_confidence,
  evidence_count,
  profile_version
)
values (
  '16000000-0000-0000-0000-000000000001',
  (select id from public.artists where legacy_owner_id='16000000-0000-0000-0000-000000000001'),
  '{"enabled":true,"harmonicAdventure":0.5,"transitionAggressiveness":0.5,"exploration":0.45}'::jsonb,
  '{}'::jsonb,
  0.0,
  0,
  1
);

select is((select count(*)::integer from public.dj_profiles), 1, 'owner can create and read their DJ profile');
select is(
  (select owner_id from public.dj_profiles limit 1),
  '16000000-0000-0000-0000-000000000001'::uuid,
  'RLS returns the current owner profile'
);

select throws_ok(
  $$
    insert into public.dj_profiles (owner_id, artist_id)
    values (
      '16000000-0000-0000-0000-000000000002',
      (select id from public.artists where legacy_owner_id='16000000-0000-0000-0000-000000000002')
    )
  $$,
  '42501',
  null,
  'owner cannot create a DJ profile for another account'
);

select throws_ok(
  $$ update public.dj_profiles set learned_confidence = 0.61 $$,
  '23514',
  null,
  'learned influence is database-capped at sixty percent'
);

reset role;

insert into public.releases (id, owner_id, title, slug)
values ('46000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001','DJ Evidence Release','dj-evidence-release');

insert into public.tracks (id, release_id, owner_id, title, audio_url)
values
  ('56000000-0000-0000-0000-000000000001','46000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001','Evidence One','https://example.com/evidence-one.wav'),
  ('56000000-0000-0000-0000-000000000002','46000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001','Evidence Two','https://example.com/evidence-two.wav');

insert into public.automix_jobs (
  id, owner_id, artist_id, track_ids, status, idempotency_key, output_path
)
values (
  '66000000-0000-0000-0000-000000000001',
  '16000000-0000-0000-0000-000000000001',
  (select artist_id from public.tracks where id='56000000-0000-0000-0000-000000000001'),
  array['56000000-0000-0000-0000-000000000001'::uuid,'56000000-0000-0000-0000-000000000002'::uuid],
  'planned',
  'dj-evidence-planned',
  'automix/dj-evidence.mp3'
);

select throws_ok(
  $$insert into public.dj_preference_evidence (
      owner_id, artist_id, automix_job_id, verdict, signal
    ) values (
      '16000000-0000-0000-0000-000000000001',
      (select artist_id from public.tracks where id='56000000-0000-0000-0000-000000000001'),
      '66000000-0000-0000-0000-000000000001',
      'accepted',
      '{"harmonicAdventure":0.5}'::jsonb
    )$$,
  'P0001',
  'DJ preference evidence requires a completed verified AutoMix job',
  'unfinished AutoMix sessions cannot become learning evidence'
);

update public.automix_jobs
set status='completed', completed_at=now()
where id='66000000-0000-0000-0000-000000000001';

insert into public.dj_preference_evidence (
  owner_id, artist_id, automix_job_id, verdict, signal
)
values (
  '16000000-0000-0000-0000-000000000001',
  (select artist_id from public.tracks where id='56000000-0000-0000-0000-000000000001'),
  '66000000-0000-0000-0000-000000000001',
  'accepted',
  '{"harmonicAdventure":0.5}'::jsonb
);
select is(
  (select count(*)::integer from public.dj_preference_evidence where automix_job_id='66000000-0000-0000-0000-000000000001'),
  1,
  'completed verified AutoMix sessions may become inspectable learning evidence'
);

insert into public.dj_preference_evidence (
  owner_id, artist_id, automix_job_id, evidence_type, evidence_key, verdict, signal, weight
)
values
  (
    '16000000-0000-0000-0000-000000000001',
    (select artist_id from public.tracks where id='56000000-0000-0000-0000-000000000001'),
    '66000000-0000-0000-0000-000000000001',
    'plan_edit',
    'reorder_and_lock',
    'accepted',
    '{"tempoMovement":0.65,"energyDynamics":0.45}'::jsonb,
    0.78
  ),
  (
    '16000000-0000-0000-0000-000000000001',
    (select artist_id from public.tracks where id='56000000-0000-0000-0000-000000000001'),
    '66000000-0000-0000-0000-000000000001',
    'plan_edit',
    'override_transition',
    'accepted',
    '{"transitionAggressiveness":0.8}'::jsonb,
    0.88
  );

select is(
  (select count(*)::integer from public.dj_preference_evidence where automix_job_id='66000000-0000-0000-0000-000000000001' and evidence_type='plan_edit'),
  2,
  'one completed revision can keep multiple distinct structured decisions'
);

select throws_ok(
  $$insert into public.dj_preference_evidence (
      owner_id, artist_id, automix_job_id, evidence_type, evidence_key, verdict, signal, weight
    ) values (
      '16000000-0000-0000-0000-000000000001',
      (select artist_id from public.tracks where id='56000000-0000-0000-0000-000000000001'),
      '66000000-0000-0000-0000-000000000001',
      'plan_edit',
      'reorder_and_lock',
      'accepted',
      '{"tempoMovement":0.9}'::jsonb,
      0.78
    )$$,
  '23505',
  null,
  'the same structured decision key is idempotent per completed revision'
);

select throws_ok(
  $$insert into public.dj_preference_evidence (
      owner_id, artist_id, automix_job_id, evidence_type, evidence_key, verdict, signal, weight
    ) values (
      '16000000-0000-0000-0000-000000000001',
      (select artist_id from public.tracks where id='56000000-0000-0000-0000-000000000001'),
      '66000000-0000-0000-0000-000000000001',
      'plan_approval',
      'invalid-weight',
      'accepted',
      '{}'::jsonb,
      1.1
    )$$,
  '23514',
  null,
  'evidence weight is database-bounded to a meaningful zero-to-one interval'
);

select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select count(*)::integer from public.dj_profiles), 0, 'another account cannot read the first DJ profile');
reset role;

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='dj_profiles'
      and indexname='dj_profiles_owner_id_artist_id_key'
  ),
  'one durable DJ profile is enforced per owner and artist'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='dj_preference_evidence'
      and indexname='dj_preference_evidence_event_key'
  ),
  'structured DJ evidence has one stable event-level unique index'
);

select * from finish();
rollback;
