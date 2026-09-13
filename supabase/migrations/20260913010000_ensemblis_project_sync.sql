-- Local-first project cloud replica.
-- The portable .ensemble manifest remains authoritative on the user's device.
-- Supabase stores only a path-free semantic replica + mutation log. No media blobs live here.

create table if not exists public.ensemblis_project_replicas (
  workspace_id uuid not null,
  project_id text not null check (char_length(project_id) between 1 and 160),
  artist_id uuid null,
  created_by uuid not null,
  manifest jsonb not null check (
    jsonb_typeof(manifest) = 'object'
    and octet_length(manifest::text) <= 2097152
  ),
  current_revision integer not null check (current_revision >= 0),
  log_floor_revision integer not null check (log_floor_revision >= 0 and log_floor_revision <= current_revision),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, project_id)
);

create table if not exists public.ensemblis_project_mutations (
  workspace_id uuid not null,
  project_id text not null,
  mutation_id text not null check (char_length(mutation_id) between 1 and 200),
  actor_id uuid not null,
  device_id text not null check (char_length(device_id) between 1 and 200),
  base_revision integer not null check (base_revision >= 0),
  applied_revision integer not null check (applied_revision > 0),
  operation text not null check (operation in (
    'project.title.set',
    'recording.add',
    'recording.remove',
    'recording.metadata.update',
    'analysis.attach',
    'analysis.detach',
    'asset.attach',
    'asset.detach',
    'note.update'
  )),
  entity_id text null check (entity_id is null or char_length(entity_id) between 1 and 200),
  target text not null check (char_length(target) between 1 and 260),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 262144
  ),
  created_at timestamptz not null,
  applied_at timestamptz not null default now(),
  primary key (workspace_id, project_id, mutation_id),
  unique (workspace_id, project_id, applied_revision),
  foreign key (workspace_id, project_id)
    references public.ensemblis_project_replicas(workspace_id, project_id)
    on delete cascade
);

create index if not exists ensemblis_project_mutations_since_revision_idx
  on public.ensemblis_project_mutations(workspace_id, project_id, applied_revision);

alter table public.ensemblis_project_replicas enable row level security;
alter table public.ensemblis_project_mutations enable row level security;

-- These tables are intentionally server-only. The Studio API authenticates the user and the
-- RPCs below repeat the active-workspace-membership check as defense in depth.
revoke all on table public.ensemblis_project_replicas from anon, authenticated;
revoke all on table public.ensemblis_project_mutations from anon, authenticated;
grant all on table public.ensemblis_project_replicas to service_role;
grant all on table public.ensemblis_project_mutations to service_role;

create or replace function public.assert_ensemblis_portable_json_v1(p_value jsonb)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_nested jsonb;
  v_text text;
  v_key_lower text;
begin
  if p_value is null then
    return;
  end if;

  case jsonb_typeof(p_value)
    when 'object' then
      for v_key, v_nested in select key, value from jsonb_each(p_value)
      loop
        v_key_lower := lower(v_key);
        if v_key_lower in (
          'path', 'filepath', 'file_path', 'localpath', 'local_path', 'location',
          'fileuri', 'file_uri', 'rootpath', 'root_path'
        ) then
          raise exception 'portable project state contains device-local field %', v_key
            using errcode = '22023';
        end if;
        perform public.assert_ensemblis_portable_json_v1(v_nested);
      end loop;
    when 'array' then
      for v_nested in select value from jsonb_array_elements(p_value)
      loop
        perform public.assert_ensemblis_portable_json_v1(v_nested);
      end loop;
    when 'string' then
      v_text := p_value #>> '{}';
      if lower(v_text) like 'file://%'
        or v_text ~ '^[A-Za-z]:[\\/]'
        or left(v_text, 2) = E'\\\\'
        or lower(v_text) like '/users/%'
        or lower(v_text) like '/home/%'
        or lower(v_text) like '/volumes/%'
        or lower(v_text) like '/mnt/%'
        or lower(v_text) like '/media/%'
      then
        raise exception 'portable project state contains a device-local locator'
          using errcode = '22023';
      end if;
    else
      null;
  end case;
end;
$$;

create or replace function public.assert_ensemblis_project_scope_v1(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_artist_id uuid default null
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.workspace_memberships membership
    where membership.workspace_id = p_workspace_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
  ) then
    raise exception 'active workspace membership is required'
      using errcode = '42501';
  end if;

  if p_artist_id is not null and not exists (
    select 1
    from public.artists artist
    where artist.id = p_artist_id
      and artist.workspace_id = p_workspace_id
  ) then
    raise exception 'artist does not belong to workspace'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.bootstrap_ensemblis_project_replica_v1(
  p_workspace_id uuid,
  p_artist_id uuid,
  p_project_id text,
  p_actor_id uuid,
  p_manifest jsonb,
  p_revision integer
)
returns table (
  status text,
  current_revision integer,
  log_floor_revision integer,
  manifest jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_replica public.ensemblis_project_replicas%rowtype;
begin
  perform public.assert_ensemblis_project_scope_v1(p_workspace_id, p_actor_id, p_artist_id);

  if p_project_id is null or btrim(p_project_id) = '' or char_length(p_project_id) > 160 then
    raise exception 'invalid project id' using errcode = '22023';
  end if;
  if p_revision is null or p_revision < 0 then
    raise exception 'invalid project revision' using errcode = '22023';
  end if;
  if octet_length(p_manifest::text) > 2097152 then
    raise exception 'portable manifest exceeds the 2 MiB cloud replica budget' using errcode = '22023';
  end if;
  if jsonb_typeof(p_manifest) <> 'object'
    or p_manifest ->> 'version' <> 'ensemblis.project.v1'
    or p_manifest ->> 'projectId' <> p_project_id
    or not (p_manifest ? 'revision')
    or (p_manifest ->> 'revision') !~ '^[0-9]+$'
    or (p_manifest ->> 'revision')::integer <> p_revision
  then
    raise exception 'portable manifest identity or revision is invalid' using errcode = '22023';
  end if;
  perform public.assert_ensemblis_portable_json_v1(p_manifest);

  insert into public.ensemblis_project_replicas (
    workspace_id, project_id, artist_id, created_by, manifest, current_revision, log_floor_revision
  ) values (
    p_workspace_id, p_project_id, p_artist_id, p_actor_id, p_manifest, p_revision, p_revision
  )
  on conflict (workspace_id, project_id) do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_replica
  from public.ensemblis_project_replicas replica
  where replica.workspace_id = p_workspace_id
    and replica.project_id = p_project_id
  for update;

  if v_replica.artist_id is not null and p_artist_id is distinct from v_replica.artist_id then
    raise exception 'project replica belongs to another artist context' using errcode = '42501';
  end if;

  if v_inserted = 1 then
    return query select 'created'::text, v_replica.current_revision, v_replica.log_floor_revision, v_replica.manifest;
    return;
  end if;

  if v_replica.current_revision = p_revision and v_replica.manifest = p_manifest then
    if v_replica.artist_id is null and p_artist_id is not null then
      update public.ensemblis_project_replicas replica
      set artist_id = p_artist_id, updated_at = now()
      where replica.workspace_id = p_workspace_id and replica.project_id = p_project_id;
    end if;
    return query select 'existing'::text, v_replica.current_revision, v_replica.log_floor_revision, v_replica.manifest;
    return;
  end if;

  return query select 'bootstrap_conflict'::text, v_replica.current_revision, v_replica.log_floor_revision, v_replica.manifest;
end;
$$;

create or replace function public.commit_ensemblis_project_mutation_v1(
  p_workspace_id uuid,
  p_project_id text,
  p_actor_id uuid,
  p_device_id text,
  p_expected_revision integer,
  p_mutation_id text,
  p_base_revision integer,
  p_operation text,
  p_entity_id text,
  p_target text,
  p_payload jsonb,
  p_created_at timestamptz,
  p_next_manifest jsonb
)
returns table (
  status text,
  current_revision integer,
  log_floor_revision integer,
  manifest jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_replica public.ensemblis_project_replicas%rowtype;
  v_existing public.ensemblis_project_mutations%rowtype;
  v_next_revision integer;
begin
  perform public.assert_ensemblis_project_scope_v1(p_workspace_id, p_actor_id, null);

  if p_project_id is null or btrim(p_project_id) = '' or char_length(p_project_id) > 160
    or p_device_id is null or btrim(p_device_id) = '' or char_length(p_device_id) > 200
    or p_mutation_id is null or btrim(p_mutation_id) = '' or char_length(p_mutation_id) > 200
    or p_expected_revision is null or p_expected_revision < 0
    or p_base_revision is null or p_base_revision < 0
    or p_created_at is null
  then
    raise exception 'invalid semantic project mutation identity' using errcode = '22023';
  end if;

  if p_operation not in (
    'project.title.set', 'recording.add', 'recording.remove', 'recording.metadata.update',
    'analysis.attach', 'analysis.detach', 'asset.attach', 'asset.detach', 'note.update'
  ) then
    raise exception 'unsupported semantic project mutation operation' using errcode = '22023';
  end if;
  if p_operation = 'project.title.set' then
    if p_target <> 'project:title' then
      raise exception 'project title mutation target is invalid' using errcode = '22023';
    end if;
  else
    if p_entity_id is null or btrim(p_entity_id) = '' or char_length(p_entity_id) > 200 then
      raise exception 'semantic entity mutation requires entity id' using errcode = '22023';
    end if;
    if (p_operation like 'recording.%' and p_target <> ('recording:' || p_entity_id))
      or (p_operation like 'analysis.%' and p_target <> ('analysis:' || p_entity_id))
      or (p_operation like 'asset.%' and p_target <> ('asset:' || p_entity_id))
      or (p_operation = 'note.update' and p_target <> ('note:' || p_entity_id))
    then
      raise exception 'semantic mutation target does not match operation' using errcode = '22023';
    end if;
  end if;

  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_next_manifest) <> 'object' then
    raise exception 'semantic mutation payloads must be objects' using errcode = '22023';
  end if;
  if octet_length(p_payload::text) > 262144 then
    raise exception 'semantic mutation exceeds the 256 KiB payload budget' using errcode = '22023';
  end if;
  if octet_length(p_next_manifest::text) > 2097152 then
    raise exception 'portable manifest exceeds the 2 MiB cloud replica budget' using errcode = '22023';
  end if;
  perform public.assert_ensemblis_portable_json_v1(p_payload);
  perform public.assert_ensemblis_portable_json_v1(p_next_manifest);

  select * into v_replica
  from public.ensemblis_project_replicas replica
  where replica.workspace_id = p_workspace_id
    and replica.project_id = p_project_id
  for update;

  if not found then
    return query select 'not_found'::text, null::integer, null::integer, null::jsonb;
    return;
  end if;

  select * into v_existing
  from public.ensemblis_project_mutations mutation
  where mutation.workspace_id = p_workspace_id
    and mutation.project_id = p_project_id
    and mutation.mutation_id = p_mutation_id;

  if found then
    if v_existing.actor_id <> p_actor_id
      or v_existing.device_id <> p_device_id
      or v_existing.base_revision <> p_base_revision
      or v_existing.operation <> p_operation
      or v_existing.entity_id is distinct from p_entity_id
      or v_existing.target <> p_target
      or v_existing.payload <> p_payload
      or v_existing.created_at <> p_created_at
    then
      raise exception 'mutation id was reused with different content' using errcode = '23505';
    end if;
    return query select 'idempotent'::text, v_replica.current_revision, v_replica.log_floor_revision, v_replica.manifest;
    return;
  end if;

  if v_replica.current_revision <> p_expected_revision then
    return query select 'revision_conflict'::text, v_replica.current_revision, v_replica.log_floor_revision, v_replica.manifest;
    return;
  end if;

  v_next_revision := p_expected_revision + 1;
  if p_next_manifest ->> 'version' <> 'ensemblis.project.v1'
    or p_next_manifest ->> 'projectId' <> p_project_id
    or not (p_next_manifest ? 'revision')
    or (p_next_manifest ->> 'revision') !~ '^[0-9]+$'
    or (p_next_manifest ->> 'revision')::integer <> v_next_revision
  then
    raise exception 'next portable manifest identity or revision is invalid' using errcode = '22023';
  end if;

  insert into public.ensemblis_project_mutations (
    workspace_id, project_id, mutation_id, actor_id, device_id, base_revision,
    applied_revision, operation, entity_id, target, payload, created_at
  ) values (
    p_workspace_id, p_project_id, p_mutation_id, p_actor_id, p_device_id, p_base_revision,
    v_next_revision, p_operation, p_entity_id, p_target, p_payload, p_created_at
  );

  update public.ensemblis_project_replicas replica
  set manifest = p_next_manifest,
      current_revision = v_next_revision,
      updated_at = now()
  where replica.workspace_id = p_workspace_id
    and replica.project_id = p_project_id;

  return query select 'applied'::text, v_next_revision, v_replica.log_floor_revision, p_next_manifest;
end;
$$;

revoke execute on function public.assert_ensemblis_portable_json_v1(jsonb) from public, anon, authenticated;
revoke execute on function public.assert_ensemblis_project_scope_v1(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.bootstrap_ensemblis_project_replica_v1(uuid, uuid, text, uuid, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.commit_ensemblis_project_mutation_v1(uuid, text, uuid, text, integer, text, integer, text, text, text, jsonb, timestamptz, jsonb) from public, anon, authenticated;

grant execute on function public.bootstrap_ensemblis_project_replica_v1(uuid, uuid, text, uuid, jsonb, integer) to service_role;
grant execute on function public.commit_ensemblis_project_mutation_v1(uuid, text, uuid, text, integer, text, integer, text, text, text, jsonb, timestamptz, jsonb) to service_role;
