begin;

select plan(9);

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

insert into public.workspaces (id, name, slug, kind, created_by, legacy_owner_id)
values
  ('23000000-0000-0000-0000-000000000001','Artist A Workspace','artist-a-workspace','personal','13000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000001'),
  ('23000000-0000-0000-0000-000000000002','Artist B Workspace','artist-b-workspace','personal','13000000-0000-0000-0000-000000000002','13000000-0000-0000-0000-000000000002');

insert into public.workspace_memberships (workspace_id, profile_id, role, status)
values
  ('23000000-0000-0000-0000-000000000001','13000000-0000-0000-0000-000000000001','owner','active'),
  ('23000000-0000-0000-0000-000000000002','13000000-0000-0000-0000-000000000002','owner','active');

insert into public.artists (id, workspace_id, name, slug, legacy_owner_id)
values
  ('33000000-0000-0000-0000-000000000001','23000000-0000-0000-0000-000000000001','Artist A','artist-a','13000000-0000-0000-0000-000000000001'),
  ('33000000-0000-0000-0000-000000000002','23000000-0000-0000-0000-000000000002','Artist B','artist-b','13000000-0000-0000-0000-000000000002');

select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000001', true);
select ok(private.is_workspace_member('23000000-0000-0000-0000-000000000001'), 'member helper accepts the current workspace');
select ok(not private.is_workspace_member('23000000-0000-0000-0000-000000000002'), 'member helper rejects another workspace');
select ok(private.can_access_artist('33000000-0000-0000-0000-000000000001'), 'artist helper accepts the current artist');
select ok(not private.can_access_artist('33000000-0000-0000-0000-000000000002'), 'artist helper rejects another artist');

set local role authenticated;
select is((select count(*)::integer from public.workspaces), 1, 'RLS exposes only the current member workspace');
select is((select count(*)::integer from public.artists), 1, 'RLS exposes only the current member artist');
reset role;

select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select name from public.artists limit 1), 'Artist B', 'switching identity cannot expose Artist A');
reset role;

select * from finish();
rollback;
