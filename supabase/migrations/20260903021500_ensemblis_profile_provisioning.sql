-- Ensemblis compatibility provisioning.
--
-- #69 backfilled profiles that existed at migration time. #70 makes release artist scope
-- mandatory, so profiles created later must receive the same deterministic personal
-- workspace + default artist foundation. This is product behavior, not a test-only shim.

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

  select * into v_workspace
  from public.workspaces
  where legacy_owner_id = p_profile_id
  limit 1;

  if not found then
    v_name := coalesce(
      nullif(trim(split_part(coalesce(p_email, ''), '@', 1)), ''),
      'Artist'
    );
    v_artist_slug := private.ensemblis_slugify(v_name);
    v_workspace_slug := v_artist_slug || '-' || replace(p_profile_id::text, '-', '');

    insert into public.workspaces(name, slug, kind, created_by, legacy_owner_id)
    values (
      v_name || ' Workspace',
      v_workspace_slug,
      'personal',
      p_profile_id,
      p_profile_id
    )
    returning * into v_workspace;
  end if;

  insert into public.workspace_memberships(workspace_id, profile_id, role, status)
  values (v_workspace.id, p_profile_id, 'owner', 'active')
  on conflict (workspace_id, profile_id) do update
    set role = case
          when public.workspace_memberships.role = 'owner' then public.workspace_memberships.role
          else excluded.role
        end,
        status = 'active',
        updated_at = now();

  select * into v_artist
  from public.artists
  where legacy_owner_id = p_profile_id
  limit 1;

  if not found then
    v_name := coalesce(
      nullif(trim(split_part(coalesce(p_email, ''), '@', 1)), ''),
      'Artist'
    );
    v_artist_slug := private.ensemblis_slugify(v_name);

    insert into public.artists(workspace_id, name, slug, legacy_owner_id)
    values (v_workspace.id, v_name, v_artist_slug, p_profile_id)
    returning * into v_artist;
  elsif v_artist.workspace_id <> v_workspace.id then
    raise exception 'Legacy artist and workspace mappings disagree for profile %', p_profile_id;
  end if;

  return v_artist.id;
end;
$$;

revoke all on function private.ensure_ensemblis_profile_foundation(uuid, text)
  from public, anon, authenticated;

create or replace function private.provision_ensemblis_profile_foundation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_ensemblis_profile_foundation(new.id, new.email);
  return new;
end;
$$;

revoke all on function private.provision_ensemblis_profile_foundation()
  from public, anon, authenticated;

drop trigger if exists provision_ensemblis_profile_foundation on public.profiles;
create trigger provision_ensemblis_profile_foundation
  after insert on public.profiles
  for each row execute function private.provision_ensemblis_profile_foundation();

-- Repair any profiles created between the #69 foundation deployment and this migration.
do $$
declare
  profile_row record;
begin
  for profile_row in select id, email from public.profiles loop
    perform private.ensure_ensemblis_profile_foundation(profile_row.id, profile_row.email);
  end loop;
end $$;
