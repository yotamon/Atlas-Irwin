begin;

select plan(10);

insert into auth.users (id, email, aud, role, created_at, updated_at)
values ('17000000-0000-0000-0000-000000000001','artist-ai-policy@example.com','authenticated','authenticated',now(),now());

update public.profiles
set is_admin = true
where id = '17000000-0000-0000-0000-000000000001';

select ok(
  private.artist_ai_capability_allowed(
    (select id from public.artists where legacy_owner_id = '17000000-0000-0000-0000-000000000001'),
    'writing'
  ),
  'human artists allow behind-the-scenes AI writing by conservative default'
);
select ok(
  not private.artist_ai_capability_allowed(
    (select id from public.artists where legacy_owner_id = '17000000-0000-0000-0000-000000000001'),
    'visuals'
  ),
  'human artists do not allow generative visuals by default'
);
select ok(
  not private.artist_ai_capability_allowed(
    (select id from public.artists where legacy_owner_id = '17000000-0000-0000-0000-000000000001'),
    'music'
  ),
  'human artists do not allow AI music by default'
);
select ok(
  not private.artist_ai_capability_allowed(
    (select id from public.artists where legacy_owner_id = '17000000-0000-0000-0000-000000000001'),
    'voice'
  ),
  'synthetic voice always requires explicit opt-in'
);
select ok(
  not private.artist_ai_capability_allowed(
    (select id from public.artists where legacy_owner_id = '17000000-0000-0000-0000-000000000001'),
    'likeness'
  ),
  'synthetic likeness always requires explicit opt-in'
);

update public.artists
set project_type = 'ai_assisted'
where legacy_owner_id = '17000000-0000-0000-0000-000000000001';

select ok(
  private.artist_ai_capability_allowed(
    (select id from public.artists where legacy_owner_id = '17000000-0000-0000-0000-000000000001'),
    'visuals'
  ),
  'AI-assisted artists may use generative visuals before a profile override exists'
);
select ok(
  private.artist_ai_capability_allowed(
    (select id from public.artists where legacy_owner_id = '17000000-0000-0000-0000-000000000001'),
    'music'
  ),
  'AI-assisted artists may use AI music before a profile override exists'
);

insert into public.artist_operating_profiles (
  artist_id,
  ai_writing_allowed,
  ai_visuals_allowed,
  ai_music_allowed,
  ai_voice_allowed,
  ai_likeness_allowed
) values (
  (select id from public.artists where legacy_owner_id = '17000000-0000-0000-0000-000000000001'),
  false,
  false,
  false,
  false,
  false
);

select ok(
  not private.artist_ai_capability_allowed(
    (select id from public.artists where legacy_owner_id = '17000000-0000-0000-0000-000000000001'),
    'writing'
  ),
  'explicit profile choice can turn AI writing off'
);
select ok(
  not private.artist_ai_capability_allowed(
    (select id from public.artists where legacy_owner_id = '17000000-0000-0000-0000-000000000001'),
    'visuals'
  ),
  'explicit profile choice overrides AI-assisted visual default'
);

update public.artist_operating_profiles
set ai_voice_allowed = true
where artist_id = (select id from public.artists where legacy_owner_id = '17000000-0000-0000-0000-000000000001');

select ok(
  private.artist_ai_capability_allowed(
    (select id from public.artists where legacy_owner_id = '17000000-0000-0000-0000-000000000001'),
    'voice'
  ),
  'synthetic voice becomes available only after explicit opt-in'
);

select * from finish();
rollback;
