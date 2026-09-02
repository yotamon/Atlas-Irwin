begin;

select plan(18);

insert into auth.users (id, email, aud, role, created_at, updated_at)
values
  ('14000000-0000-0000-0000-000000000001','music-a@example.com','authenticated','authenticated',now(),now()),
  ('14000000-0000-0000-0000-000000000002','music-b@example.com','authenticated','authenticated',now(),now());

update public.profiles
set is_admin = true
where id in (
  '14000000-0000-0000-0000-000000000001',
  '14000000-0000-0000-0000-000000000002'
);

-- Replace auto-provisioned fixture rows with stable IDs so lineage assertions remain explicit.
delete from public.workspaces
where legacy_owner_id in (
  '14000000-0000-0000-0000-000000000001',
  '14000000-0000-0000-0000-000000000002'
);

insert into public.workspaces (id, name, slug, kind, created_by, legacy_owner_id)
values
  ('24000000-0000-0000-0000-000000000001','Music A Workspace','music-a-workspace','personal','14000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001'),
  ('24000000-0000-0000-0000-000000000002','Music B Workspace','music-b-workspace','personal','14000000-0000-0000-0000-000000000002','14000000-0000-0000-0000-000000000002');

insert into public.workspace_memberships (workspace_id, profile_id, role, status)
values
  ('24000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001','owner','active'),
  ('24000000-0000-0000-0000-000000000002','14000000-0000-0000-0000-000000000002','owner','active');

insert into public.artists (id, workspace_id, name, slug, legacy_owner_id)
values
  ('34000000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000001','Artist Alpha','artist-alpha','14000000-0000-0000-0000-000000000001'),
  ('34000000-0000-0000-0000-000000000002','24000000-0000-0000-0000-000000000002','Artist Beta','artist-beta','14000000-0000-0000-0000-000000000002'),
  ('34000000-0000-0000-0000-000000000003','24000000-0000-0000-0000-000000000001','Artist Alpha Side','artist-alpha-side',null);

-- Legacy callers may omit artist_id only when a deterministic legacy/default artist exists.
insert into public.releases (id, owner_id, title, slug)
values ('44000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001','Alpha Release','alpha-release');

select is(
  (select artist_id from public.releases where id='44000000-0000-0000-0000-000000000001'),
  '34000000-0000-0000-0000-000000000001'::uuid,
  'legacy release insert resolves the owner default artist'
);
select is(
  (select artist from public.releases where id='44000000-0000-0000-0000-000000000001'),
  'Artist Alpha',
  'legacy public artist label is synchronized from Ensemblis artist identity'
);

insert into public.releases (id, owner_id, artist_id, title, slug)
values ('44000000-0000-0000-0000-000000000002','14000000-0000-0000-0000-000000000002','34000000-0000-0000-0000-000000000002','Beta Release','beta-release');

-- One account may manage several artists. Slugs are artist-local, not profile-local.
insert into public.releases (id, owner_id, artist_id, title, slug)
values ('44000000-0000-0000-0000-000000000003','14000000-0000-0000-0000-000000000001','34000000-0000-0000-0000-000000000003','Alpha Side Release','alpha-release');

select is(
  (select count(*)::integer from public.releases where owner_id='14000000-0000-0000-0000-000000000001' and slug='alpha-release'),
  2,
  'the same owner may reuse a release slug across two artists'
);

select throws_ok(
  $$insert into public.releases (id, owner_id, artist_id, title, slug)
    values ('44000000-0000-0000-0000-000000000099','14000000-0000-0000-0000-000000000001','34000000-0000-0000-0000-000000000003','Duplicate Side Release','alpha-release')$$,
  '23505',
  'duplicate key value violates unique constraint "releases_artist_id_slug_key"',
  'a release slug remains unique inside one artist'
);

insert into public.tracks (id, release_id, owner_id, title, audio_url)
values ('54000000-0000-0000-0000-000000000001','44000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001','Alpha Track','https://example.com/alpha.wav');

select is(
  (select artist_id from public.tracks where id='54000000-0000-0000-0000-000000000001'),
  '34000000-0000-0000-0000-000000000001'::uuid,
  'track inherits release artist'
);

select throws_ok(
  $$insert into public.tracks (id, release_id, owner_id, artist_id, title)
    values ('54000000-0000-0000-0000-000000000099','44000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001','34000000-0000-0000-0000-000000000002','Wrong Artist Track')$$,
  'P0001',
  'Track artist must match release artist',
  'a caller cannot attach a track to a different artist than its release'
);

insert into public.tracks (id, release_id, owner_id, title, audio_url)
values ('54000000-0000-0000-0000-000000000003','44000000-0000-0000-0000-000000000003','14000000-0000-0000-0000-000000000001','Alpha Side Track','https://example.com/alpha-side.wav');
select is(
  (select artist_id from public.tracks where id='54000000-0000-0000-0000-000000000003'),
  '34000000-0000-0000-0000-000000000003'::uuid,
  'same-owner secondary-artist track inherits the secondary release artist'
);

insert into public.track_music_intelligence(track_id, owner_id, analysis_version, engine, quality, semantic_structure, analysis)
values ('54000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001',3,'test','full',true,'{"source":"worker","version":3}'::jsonb);
select is(
  (select artist_id from public.track_music_intelligence where track_id='54000000-0000-0000-0000-000000000001'),
  '34000000-0000-0000-0000-000000000001'::uuid,
  'Track Intelligence inherits track artist'
);

insert into public.track_lyrics(id, owner_id, track_id, status, canonical_text)
values ('64000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000001','verified','One line');
select is(
  (select artist_id from public.track_lyrics where id='64000000-0000-0000-0000-000000000001'),
  '34000000-0000-0000-0000-000000000001'::uuid,
  'canonical lyrics inherit track artist'
);

insert into public.track_lyrics_revisions(lyrics_id, owner_id, version, status, canonical_text)
values ('64000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001',1,'verified','One line');
select is(
  (select artist_id from public.track_lyrics_revisions where lyrics_id='64000000-0000-0000-0000-000000000001' and version=1),
  '34000000-0000-0000-0000-000000000001'::uuid,
  'lyrics revisions inherit canonical lyrics artist'
);

insert into public.media_assets(id, owner_id, bucket_name, storage_path, asset_type, visibility)
values ('74000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001','studio-assets','alpha/stem.wav','stem','private');
insert into public.track_stems(id, owner_id, track_id, media_asset_id, label, source_master_url)
values ('84000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000001','Vocals','https://example.com/alpha.wav');
select is(
  (select artist_id from public.track_stems where id='84000000-0000-0000-0000-000000000001'),
  '34000000-0000-0000-0000-000000000001'::uuid,
  'stems inherit track artist'
);

insert into public.audio_scenes(id, owner_id, track_id, name, scene_type, recipe)
values ('94000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000001','Vocal Scene','vocal_spotlight','{}'::jsonb);
select is(
  (select artist_id from public.audio_scenes where id='94000000-0000-0000-0000-000000000001'),
  '34000000-0000-0000-0000-000000000001'::uuid,
  'Audio Scenes inherit track artist'
);

insert into public.track_external_ids(owner_id, track_id, provider, external_id)
values ('14000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000001','isrc','TEST-ALPHA-001');
select is(
  (select artist_id from public.track_external_ids where external_id='TEST-ALPHA-001'),
  '34000000-0000-0000-0000-000000000001'::uuid,
  'track external identities inherit track artist'
);

insert into public.release_external_links(owner_id, release_id, provider, external_url)
values ('14000000-0000-0000-0000-000000000001','44000000-0000-0000-0000-000000000001','spotify','https://open.spotify.com/album/test-alpha');
select is(
  (select artist_id from public.release_external_links where external_url='https://open.spotify.com/album/test-alpha'),
  '34000000-0000-0000-0000-000000000001'::uuid,
  'release external identities inherit release artist'
);

update public.artists set name='Artist Alpha Renamed' where id='34000000-0000-0000-0000-000000000001';
select is(
  (select artist from public.releases where id='44000000-0000-0000-0000-000000000001'),
  'Artist Alpha Renamed',
  'artist rename synchronizes the legacy public release artist label'
);

-- Populate one Beta track so RLS is tested against real music-domain rows.
insert into public.tracks (id, release_id, owner_id, title, audio_url)
values ('54000000-0000-0000-0000-000000000002','44000000-0000-0000-0000-000000000002','14000000-0000-0000-0000-000000000002','Beta Track','https://example.com/beta.wav');

-- Workspace membership legitimately grants database access to both artists in that workspace.
-- Active-artist isolation is enforced by the application context guards, not by pretending RLS
-- is a per-tab artist switcher.
select set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is((select count(*)::integer from public.releases), 2, 'Artist Alpha admin can read both artists in their workspace but not Beta releases');
select is((select count(*)::integer from public.tracks), 2, 'Artist Alpha admin can read both artists in their workspace but not Beta tracks');
reset role;

select set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select title from public.releases limit 1), 'Beta Release', 'switching identity exposes only the Beta catalog');
reset role;

select * from finish();
rollback;
