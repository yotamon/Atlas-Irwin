begin;

select plan(11);

select has_table('public', 'workspaces', 'Ensemblis workspaces table exists');
select has_table('public', 'artists', 'Ensemblis artists table exists');

insert into auth.users (id, email, aud, role, created_at, updated_at)
values
  ('13000000-0000-0000-0000-000000000001','ensemblis-a@example.com','authenticated','authenticated',now(),now()),
  ('13000000-0000-0000-0000-000000000002','ensemblis-b@example.com','authenticated','authenticated',now(),now());

update public.profiles
set is_admin = true
where id in (
  '13000000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000002'
);

select is(
  (select count(*)::integer from public.workspaces where legacy_owner_id='13000000-0000-0000-0000-000000000001'),
  1,
  'new profiles receive one deterministic compatibility workspace'
);
select is(
  (select count(*)::integer from public.artists where legacy_owner_id='13000000-0000-0000-0000-000000000001'),
  1,
  'new profiles receive one deterministic default artist'
);

select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000001', true);
select ok(
  private.is_workspace_member((select id from public.workspaces where legacy_owner_id='13000000-0000-0000-0000-000000000001')),
  'member helper accepts the current workspace'
);
select ok(
  not private.is_workspace_member((select id from public.workspaces where legacy_owner_id='13000000-0000-0000-0000-000000000002')),
  'member helper rejects another workspace'
);
select ok(
  private.can_access_artist((select id from public.artists where legacy_owner_id='13000000-0000-0000-0000-000000000001')),
  'artist helper accepts the current artist'
);
select ok(
  not private.can_access_artist((select id from public.artists where legacy_owner_id='13000000-0000-0000-0000-000000000002')),
  'artist helper rejects another artist'
);

set local role authenticated;
select is((select count(*)::integer from public.workspaces), 1, 'RLS exposes only the current member workspace');
select is((select count(*)::integer from public.artists), 1, 'RLS exposes only the current member artist');
reset role;

select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(
  (select legacy_owner_id from public.artists limit 1),
  '13000000-0000-0000-0000-000000000002'::uuid,
  'switching identity cannot expose Artist A'
);
reset role;

select * from finish();
rollback;
