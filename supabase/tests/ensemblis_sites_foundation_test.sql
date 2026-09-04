begin;

select plan(18);

select has_table('public', 'artist_sites', 'artist_sites table exists');
select has_table('public', 'artist_site_versions', 'artist_site_versions table exists');
select has_table('public', 'artist_site_domains', 'artist_site_domains table exists');
select has_table('public', 'artist_site_deployments', 'artist_site_deployments table exists');

insert into auth.users (id, email, aud, role, created_at, updated_at)
values
  ('24000000-0000-0000-0000-000000000001','sites-a@example.com','authenticated','authenticated',now(),now()),
  ('24000000-0000-0000-0000-000000000002','sites-b@example.com','authenticated','authenticated',now(),now());

update public.profiles
set is_admin = true
where id in (
  '24000000-0000-0000-0000-000000000001',
  '24000000-0000-0000-0000-000000000002'
);

insert into public.artist_sites (id, artist_id, slug, template_key)
values
  (
    '24100000-0000-0000-0000-000000000001',
    (select id from public.artists where legacy_owner_id='24000000-0000-0000-0000-000000000001'),
    'sites-a',
    'artist-editorial'
  ),
  (
    '24100000-0000-0000-0000-000000000002',
    (select id from public.artists where legacy_owner_id='24000000-0000-0000-0000-000000000002'),
    'sites-b',
    'artist-editorial'
  );

insert into public.artist_site_versions (
  id,
  site_id,
  version_number,
  status,
  template_key,
  template_version,
  config,
  content_snapshot,
  created_by
) values
  (
    '24200000-0000-0000-0000-000000000001',
    '24100000-0000-0000-0000-000000000001',
    1,
    'draft',
    'artist-editorial',
    1,
    '{"theme":{"background":"#111111"}}',
    '{"schemaVersion":1,"artist":{"id":"24000000-0000-0000-0000-000000000001"}}',
    '24000000-0000-0000-0000-000000000001'
  ),
  (
    '24200000-0000-0000-0000-000000000002',
    '24100000-0000-0000-0000-000000000002',
    1,
    'draft',
    'artist-editorial',
    1,
    '{"theme":{"background":"#222222"}}',
    '{"schemaVersion":1,"artist":{"id":"24000000-0000-0000-0000-000000000002"}}',
    '24000000-0000-0000-0000-000000000002'
  );

update public.artist_sites set draft_version_id='24200000-0000-0000-0000-000000000001'
where id='24100000-0000-0000-0000-000000000001';
update public.artist_sites set draft_version_id='24200000-0000-0000-0000-000000000002'
where id='24100000-0000-0000-0000-000000000002';

select set_config('request.jwt.claim.sub', '24000000-0000-0000-0000-000000000001', true);
select ok(
  private.can_access_artist_site('24100000-0000-0000-0000-000000000001'),
  'site access helper accepts the current artist site'
);
select ok(
  not private.can_access_artist_site('24100000-0000-0000-0000-000000000002'),
  'site access helper rejects another artist site'
);

set local role authenticated;
select is((select count(*)::integer from public.artist_sites), 1, 'RLS exposes only the current artist site');
select is((select count(*)::integer from public.artist_site_versions), 1, 'RLS exposes only the current artist site versions');
select is(
  public.publish_artist_site(
    '24100000-0000-0000-0000-000000000001',
    '24200000-0000-0000-0000-000000000001'
  ),
  '24200000-0000-0000-0000-000000000001'::uuid,
  'publishing returns the immutable version id'
);
select is(
  (select state from public.artist_sites where id='24100000-0000-0000-0000-000000000001'),
  'published',
  'publish atomically moves the site to published state'
);
select is(
  (select status from public.artist_site_versions where id='24200000-0000-0000-0000-000000000001'),
  'published',
  'publish freezes the selected draft as published'
);
select is(
  (select template_key from public.artist_site_versions where id='24200000-0000-0000-0000-000000000001'),
  'artist-editorial',
  'published version pins template identity'
);
select is(
  (select template_version from public.artist_site_versions where id='24200000-0000-0000-0000-000000000001'),
  1,
  'published version pins template version'
);
select is(
  (select count(*)::integer from public.artist_site_deployments where site_id='24100000-0000-0000-0000-000000000001' and status='ready'),
  1,
  'publish records a ready shared-runtime deployment'
);
select ok(
  public.create_artist_site_draft('24100000-0000-0000-0000-000000000001') is not null,
  'a new draft is cloned from the published snapshot'
);
select is(
  (select version_number from public.artist_site_versions where id=(select draft_version_id from public.artist_sites where id='24100000-0000-0000-0000-000000000001')),
  2,
  'draft cloning advances the version number'
);
select is(
  (select template_version from public.artist_site_versions where id=(select draft_version_id from public.artist_sites where id='24100000-0000-0000-0000-000000000001')),
  1,
  'draft cloning preserves the pinned template version'
);
reset role;

select set_config('request.jwt.claim.sub', '24000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select slug from public.artist_sites limit 1), 'sites-b', 'switching identity cannot expose Artist A site');
reset role;

select * from finish();
rollback;
