begin;

select plan(9);

select has_table('public', 'automix_transition_previews', 'AutoMix transition previews table exists');
select is(
  (select public from storage.buckets where id = 'automix-previews'),
  false,
  'transition preview storage stays private'
);

insert into auth.users (id, email, aud, role, created_at, updated_at)
values
  ('15000000-0000-0000-0000-000000000001','preview-a@example.com','authenticated','authenticated',now(),now()),
  ('15000000-0000-0000-0000-000000000002','preview-b@example.com','authenticated','authenticated',now(),now());

update public.profiles
set is_admin = true
where id in (
  '15000000-0000-0000-0000-000000000001',
  '15000000-0000-0000-0000-000000000002'
);

insert into public.releases (id, owner_id, title, slug)
values
  ('45000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','Preview A','preview-a'),
  ('45000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000002','Preview B','preview-b');

insert into public.tracks (id, release_id, owner_id, title, audio_url)
values
  ('55000000-0000-0000-0000-000000000001','45000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','A One','https://example.com/a-one.wav'),
  ('55000000-0000-0000-0000-000000000002','45000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','A Two','https://example.com/a-two.wav'),
  ('55000000-0000-0000-0000-000000000003','45000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001','A Candidate Omitted','https://example.com/a-three.wav'),
  ('55000000-0000-0000-0000-000000000004','45000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000002','B One','https://example.com/b-one.wav'),
  ('55000000-0000-0000-0000-000000000005','45000000-0000-0000-0000-000000000002','15000000-0000-0000-0000-000000000002','B Two','https://example.com/b-two.wav');

insert into public.automix_jobs (
  id, owner_id, artist_id, name, track_ids, status, idempotency_key, output_path, result_payload
)
values
  (
    '65000000-0000-0000-0000-000000000001',
    '15000000-0000-0000-0000-000000000001',
    (select artist_id from public.tracks where id='55000000-0000-0000-0000-000000000001'),
    'Verified curated route',
    array[
      '55000000-0000-0000-0000-000000000001'::uuid,
      '55000000-0000-0000-0000-000000000002'::uuid,
      '55000000-0000-0000-0000-000000000003'::uuid
    ],
    'completed',
    'preview-parent-a',
    'automix/a.mp3',
    jsonb_build_object(
      'render_manifest', jsonb_build_object(
        'plan_hash', 'verified-plan-a',
        'transitions', jsonb_build_array(jsonb_build_object('from_track_id','55000000-0000-0000-0000-000000000001','to_track_id','55000000-0000-0000-0000-000000000002'))
      )
    )
  ),
  (
    '65000000-0000-0000-0000-000000000002',
    '15000000-0000-0000-0000-000000000001',
    (select artist_id from public.tracks where id='55000000-0000-0000-0000-000000000001'),
    'Missing plan hash',
    array[
      '55000000-0000-0000-0000-000000000001'::uuid,
      '55000000-0000-0000-0000-000000000002'::uuid
    ],
    'completed',
    'preview-parent-no-hash',
    'automix/no-hash.mp3',
    jsonb_build_object(
      'render_manifest', jsonb_build_object(
        'transitions', jsonb_build_array(jsonb_build_object('from_track_id','55000000-0000-0000-0000-000000000001','to_track_id','55000000-0000-0000-0000-000000000002'))
      )
    )
  ),
  (
    '65000000-0000-0000-0000-000000000003',
    '15000000-0000-0000-0000-000000000002',
    (select artist_id from public.tracks where id='55000000-0000-0000-0000-000000000004'),
    'Verified B route',
    array[
      '55000000-0000-0000-0000-000000000004'::uuid,
      '55000000-0000-0000-0000-000000000005'::uuid
    ],
    'completed',
    'preview-parent-b',
    'automix/b.mp3',
    jsonb_build_object(
      'render_manifest', jsonb_build_object(
        'plan_hash', 'verified-plan-b',
        'transitions', jsonb_build_array(jsonb_build_object('from_track_id','55000000-0000-0000-0000-000000000004','to_track_id','55000000-0000-0000-0000-000000000005'))
      )
    )
  );

insert into public.automix_transition_previews (
  id, owner_id, artist_id, automix_job_id, transition_index, idempotency_key, output_path
)
values (
  '75000000-0000-0000-0000-000000000001',
  '15000000-0000-0000-0000-000000000001',
  (select artist_id from public.tracks where id='55000000-0000-0000-0000-000000000001'),
  '65000000-0000-0000-0000-000000000001',
  0,
  'preview-a-transition-0',
  '15000000-0000-0000-0000-000000000001/65000000-0000-0000-0000-000000000001/75000000-0000-0000-0000-000000000001.mp3'
);

select is(
  (select transition_index from public.automix_transition_previews where id='75000000-0000-0000-0000-000000000001'),
  0,
  'a transition inside the verified render manifest is accepted'
);

select throws_ok(
  $$insert into public.automix_transition_previews (
      owner_id, artist_id, automix_job_id, transition_index, idempotency_key, output_path
    ) values (
      '15000000-0000-0000-0000-000000000001',
      (select artist_id from public.tracks where id='55000000-0000-0000-0000-000000000001'),
      '65000000-0000-0000-0000-000000000001',
      1,
      'preview-a-invalid-transition',
      'invalid-transition.mp3'
    )$$,
  'P0001',
  'Transition preview index is outside the verified parent MixPlan',
  'preview bounds follow the curated MixPlan rather than the larger candidate pool'
);

select throws_ok(
  $$insert into public.automix_transition_previews (
      owner_id, artist_id, automix_job_id, transition_index, idempotency_key, output_path, expires_at
    ) values (
      '15000000-0000-0000-0000-000000000001',
      (select artist_id from public.tracks where id='55000000-0000-0000-0000-000000000001'),
      '65000000-0000-0000-0000-000000000001',
      0,
      'preview-a-too-long',
      'too-long.mp3',
      now() + interval '26 hours'
    )$$,
  'P0001',
  'Transition preview retention cannot exceed 25 hours',
  'preview retention is bounded in the database'
);

select throws_ok(
  $$insert into public.automix_transition_previews (
      owner_id, artist_id, automix_job_id, transition_index, idempotency_key, output_path
    ) values (
      '15000000-0000-0000-0000-000000000001',
      (select artist_id from public.tracks where id='55000000-0000-0000-0000-000000000001'),
      '65000000-0000-0000-0000-000000000002',
      0,
      'preview-a-no-plan-hash',
      'no-plan-hash.mp3'
    )$$,
  'P0001',
  'Transition previews require a verified MixPlan hash',
  'a completed parent without verified MixPlan provenance cannot create a preview'
);

insert into public.automix_transition_previews (
  id, owner_id, artist_id, automix_job_id, transition_index, idempotency_key, output_path
)
values (
  '75000000-0000-0000-0000-000000000002',
  '15000000-0000-0000-0000-000000000002',
  (select artist_id from public.tracks where id='55000000-0000-0000-0000-000000000004'),
  '65000000-0000-0000-0000-000000000003',
  0,
  'preview-b-transition-0',
  '15000000-0000-0000-0000-000000000002/65000000-0000-0000-0000-000000000003/75000000-0000-0000-0000-000000000002.mp3'
);

select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.automix_transition_previews),
  1,
  'RLS exposes only User A transition previews'
);
reset role;

select set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.automix_transition_previews),
  1,
  'RLS exposes only User B transition previews'
);
reset role;

select is(
  (select count(*)::integer from public.automix_transition_previews),
  2,
  'both isolated preview fixtures remain visible to the test owner role'
);

select * from finish();
rollback;
