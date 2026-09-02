-- Ensemblis P0 foundation: separate authenticated people from workspaces and artists.
--
-- This migration is intentionally additive. Existing Studio tables continue to use
-- owner_id during the compatibility window; no existing product behavior is switched
-- to artist_id here.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  kind text not null default 'personal' check (kind in ('personal','team','label')),
  created_by uuid references public.profiles(id) on delete set null,
  legacy_owner_id uuid unique references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','manager','creative','marketing','analyst','viewer')),
  status text not null default 'active' check (status in ('active','invited','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, profile_id)
);

create table public.artists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  slug text not null check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  project_type text not null default 'human' check (project_type in ('human','ai_assisted','hybrid','virtual_persona')),
  status text not null default 'active' check (status in ('active','paused','archived')),
  avatar_url text,
  accent_color text check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  legacy_owner_id uuid unique references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create index workspace_memberships_profile_idx
  on public.workspace_memberships(profile_id, status, workspace_id);
create index artists_workspace_status_idx
  on public.artists(workspace_id, status, created_at);

create trigger set_workspaces_updated_at
  before update on public.workspaces
  for each row execute function private.set_updated_at();
create trigger set_workspace_memberships_updated_at
  before update on public.workspace_memberships
  for each row execute function private.set_updated_at();
create trigger set_artists_updated_at
  before update on public.artists
  for each row execute function private.set_updated_at();

-- Keep slug rules deterministic and deliberately boring. The normalized full
-- profile UUID makes legacy workspace slugs globally collision-proof while artist
-- slugs only need to be unique inside their workspace.
create or replace function private.ensemblis_slugify(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g')),
      ''
    ),
    'artist'
  )
$$;

revoke all on function private.ensemblis_slugify(text) from public, anon, authenticated;

-- Security-definer helpers are used by RLS so membership checks do not recurse
-- through workspace_memberships policies.
create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_memberships membership
    where membership.workspace_id = target_workspace_id
      and membership.profile_id = (select auth.uid())
      and membership.status = 'active'
  )
$$;

create or replace function private.can_access_artist(target_artist_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.artists artist
    join public.workspace_memberships membership
      on membership.workspace_id = artist.workspace_id
    where artist.id = target_artist_id
      and membership.profile_id = (select auth.uid())
      and membership.status = 'active'
  )
$$;

revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.can_access_artist(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.can_access_artist(uuid) to authenticated;

-- Idempotently map every existing profile to one compatibility workspace and artist.
-- Prefer the artist name already stored in the release catalog; fall back to a
-- readable email prefix only when no catalog identity exists.
do $$
declare
  profile_row record;
  workspace_row public.workspaces%rowtype;
  inferred_artist_name text;
  workspace_slug text;
  artist_slug text;
begin
  for profile_row in
    select id, email
    from public.profiles
    order by created_at, id
  loop
    select nullif(trim(release.artist), '')
      into inferred_artist_name
    from public.releases release
    where release.owner_id = profile_row.id
      and nullif(trim(release.artist), '') is not null
    order by release.updated_at desc, release.created_at desc
    limit 1;

    inferred_artist_name := coalesce(
      inferred_artist_name,
      nullif(trim(split_part(profile_row.email, '@', 1)), ''),
      'Artist'
    );
    artist_slug := private.ensemblis_slugify(inferred_artist_name);
    workspace_slug := artist_slug || '-' || replace(profile_row.id::text, '-', '');

    insert into public.workspaces (name, slug, kind, created_by, legacy_owner_id)
    values (inferred_artist_name || ' Workspace', workspace_slug, 'personal', profile_row.id, profile_row.id)
    on conflict (legacy_owner_id) do update
      set name = excluded.name,
          updated_at = now()
    returning * into workspace_row;

    insert into public.workspace_memberships (workspace_id, profile_id, role, status)
    values (workspace_row.id, profile_row.id, 'owner', 'active')
    on conflict (workspace_id, profile_id) do update
      set role = 'owner',
          status = 'active',
          updated_at = now();

    insert into public.artists (workspace_id, name, slug, legacy_owner_id)
    values (workspace_row.id, inferred_artist_name, artist_slug, profile_row.id)
    on conflict (legacy_owner_id) do update
      set workspace_id = excluded.workspace_id,
          name = excluded.name,
          slug = excluded.slug,
          updated_at = now();
  end loop;
end
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.artists enable row level security;

-- Foundation rollout stays behind the existing Studio-admin gate. New collaborator
-- write flows are intentionally deferred until artist scoping is proven end-to-end.
create policy "studio admins read member workspaces"
  on public.workspaces
  for select
  to authenticated
  using (private.is_studio_admin() and private.is_workspace_member(id));

create policy "studio admins read own workspace memberships"
  on public.workspace_memberships
  for select
  to authenticated
  using (private.is_studio_admin() and private.is_workspace_member(workspace_id));

create policy "studio admins read accessible artists"
  on public.artists
  for select
  to authenticated
  using (private.is_studio_admin() and private.can_access_artist(id));

revoke all on public.workspaces from anon, authenticated;
revoke all on public.workspace_memberships from anon, authenticated;
revoke all on public.artists from anon, authenticated;

grant select on public.workspaces to authenticated;
grant select on public.workspace_memberships to authenticated;
grant select on public.artists to authenticated;
