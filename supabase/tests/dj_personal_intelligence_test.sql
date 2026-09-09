begin;

select plan(10);

select has_table('public', 'dj_profiles', 'DJ profiles table exists');
select has_table('public', 'dj_preference_evidence', 'DJ preference evidence table exists');
select has_column('public', 'dj_profiles', 'explicit_preferences', 'DJ profile keeps explicit preferences separately');
select has_column('public', 'dj_profiles', 'learned_preferences', 'DJ profile keeps learned preferences separately');

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
      and indexname='dj_profiles_owner_artist_unique'
  ),
  'one durable DJ profile is enforced per owner and artist'
);

select * from finish();
rollback;
