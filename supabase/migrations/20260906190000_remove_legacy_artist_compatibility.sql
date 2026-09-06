-- Ensemblis canonical artist/workspace cleanup.
-- Workspace membership and artist_id are the only canonical scope relationships.
-- owner_id remains an authorization and audit field, not an artist lookup mechanism.

create or replace function private.ensure_ensemblis_profile_foundation(
  p_profile_id uuid,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace public.workspaces%rowtype;
  v_artist public.artists%rowtype;
  v_name text;
  v_artist_slug text;
  v_workspace_slug text;
begin
  if p_profile_id is null then
    raise exception 'Profile id is required';
  end if;

  select w.* into v_workspace
  from public.workspaces w
  join public.workspace_memberships m on m.workspace_id = w.id
  where m.profile_id = p_profile_id
    and m.status = 'active'
    and m.role = 'owner'
    and w.kind = 'personal'
  order by w.created_at, w.id
  limit 1;

  if not found then
    v_name := coalesce(
      nullif(trim(split_part(coalesce(p_email, ''), '@', 1)), ''),
      'Artist'
    );
    v_workspace_slug := 'personal-' || replace(p_profile_id::text, '-', '');

    insert into public.workspaces(name, slug, kind, created_by)
    values (v_name || ' Workspace', v_workspace_slug, 'personal', p_profile_id)
    returning * into v_workspace;
  end if;

  insert into public.workspace_memberships(workspace_id, profile_id, role, status)
  values (v_workspace.id, p_profile_id, 'owner', 'active')
  on conflict (workspace_id, profile_id) do update
    set status = 'active',
        updated_at = now();

  select a.* into v_artist
  from public.artists a
  where a.workspace_id = v_workspace.id
    and a.status = 'active'
  order by a.created_at, a.id
  limit 1;

  if not found then
    v_name := coalesce(
      nullif(trim(split_part(coalesce(p_email, ''), '@', 1)), ''),
      'Artist'
    );
    v_artist_slug := private.ensemblis_slugify(v_name);

    insert into public.artists(workspace_id, name, slug)
    values (v_workspace.id, v_name, v_artist_slug)
    returning * into v_artist;
  end if;

  return v_artist.id;
end;
$$;

revoke all on function private.ensure_ensemblis_profile_foundation(uuid, text)
  from public, anon, authenticated;

create or replace function private.validate_release_artist_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_artist_name text;
begin
  if new.artist_id is null then
    raise exception 'artist_id is required for every release';
  end if;
  if not private.profile_can_manage_artist(new.owner_id, new.artist_id) then
    raise exception 'Release owner must be an active member of the artist workspace';
  end if;

  select a.name into v_artist_name
  from public.artists a
  where a.id = new.artist_id;

  if v_artist_name is null then
    raise exception 'Release artist must exist';
  end if;

  -- Temporary denormalized catalog label. artist_id remains the canonical identity.
  new.artist := v_artist_name;
  return new;
end;
$$;

create or replace function private.validate_track_artist_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_artist_id uuid;
  v_owner_id uuid;
begin
  select r.artist_id, r.owner_id into v_artist_id, v_owner_id
  from public.releases r
  where r.id = new.release_id;

  if v_artist_id is null then
    raise exception 'Track release must exist and be artist-scoped';
  end if;
  if new.artist_id is not null and new.artist_id <> v_artist_id then
    raise exception 'Track artist must match release artist';
  end if;
  if new.owner_id <> v_owner_id then
    raise exception 'Track owner must match release owner';
  end if;

  new.artist_id := v_artist_id;
  return new;
end;
$$;

drop function if exists private.legacy_artist_for_owner(uuid);

alter table public.artists drop column if exists legacy_owner_id;
alter table public.workspaces drop column if exists legacy_owner_id;
