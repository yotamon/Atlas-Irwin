-- Ensemblis DJ Library Bridge / Phase 8
-- Cloud state is deliberately path-free. Filesystem bindings live only in the native bridge SQLite DB.

create table if not exists public.dj_library_devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  public_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  platform text not null check (platform in ('windows','macos','linux')),
  app_version text not null default 'unknown',
  credential_hash text not null check (credential_hash ~ '^[0-9a-f]{64}$'),
  credential_prefix text not null check (char_length(credential_prefix) between 4 and 16),
  capabilities jsonb not null default '{}'::jsonb check (jsonb_typeof(capabilities) = 'object'),
  paired_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, artist_id, public_id)
);

create unique index if not exists dj_library_devices_credential_hash_idx
  on public.dj_library_devices(credential_hash);
create index if not exists dj_library_devices_artist_idx
  on public.dj_library_devices(owner_id, artist_id, revoked_at, last_seen_at desc);

create table if not exists public.dj_library_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists dj_library_pairing_codes_expiry_idx
  on public.dj_library_pairing_codes(expires_at) where used_at is null;

create table if not exists public.dj_library_device_sources (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.dj_library_devices(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  source_id text not null check (char_length(source_id) between 1 and 200),
  source_kind text not null check (source_kind in ('local_library','rekordbox','serato','traktor')),
  revision text,
  track_count integer not null default 0 check (track_count >= 0),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, source_id)
);

create index if not exists dj_library_device_sources_artist_idx
  on public.dj_library_device_sources(owner_id, artist_id, updated_at desc);

create table if not exists public.dj_library_source_tracks (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.dj_library_devices(id) on delete cascade,
  device_source_id uuid not null references public.dj_library_device_sources(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  source_id text not null,
  source_track_id text not null check (char_length(source_track_id) between 1 and 512),
  recording_fingerprint text not null check (recording_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  playlist_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(playlist_ids) = 'array'),
  cue_points jsonb not null default '[]'::jsonb check (jsonb_typeof(cue_points) = 'array'),
  beat_grid jsonb,
  analysis_provenance jsonb not null default '[]'::jsonb check (jsonb_typeof(analysis_provenance) = 'array'),
  availability text not null default 'unknown' check (availability in ('available','missing','offline','unknown')),
  revision text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, source_id, source_track_id)
);

create index if not exists dj_library_source_tracks_fingerprint_idx
  on public.dj_library_source_tracks(owner_id, artist_id, recording_fingerprint);
create index if not exists dj_library_source_tracks_source_idx
  on public.dj_library_source_tracks(device_source_id, source_track_id);

-- Chunks are staging only. A complete target revision is applied by one SQL transaction and then
-- deleted, so browser/planner consumers can never observe a half-applied library revision.
create table if not exists public.dj_library_sync_chunks (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.dj_library_devices(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  source_id text not null check (char_length(source_id) between 1 and 200),
  source_kind text not null check (source_kind in ('local_library','rekordbox','serato','traktor')),
  base_revision text,
  target_revision text not null check (char_length(target_revision) between 1 and 200),
  batch_index integer not null check (batch_index >= 0),
  batch_count integer not null check (batch_count between 1 and 1000),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (device_id, source_id, target_revision, batch_index)
);

create index if not exists dj_library_sync_chunks_revision_idx
  on public.dj_library_sync_chunks(device_id, source_id, target_revision, batch_index);
create index if not exists dj_library_sync_chunks_created_idx
  on public.dj_library_sync_chunks(created_at);

create table if not exists public.dj_library_device_jobs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.dj_library_devices(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  job_type text not null check (job_type in ('resolve_media')),
  source_revision text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'queued' check (status in ('queued','claimed','completed','failed','cancelled')),
  result jsonb,
  error text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, idempotency_key)
);

create index if not exists dj_library_device_jobs_queue_idx
  on public.dj_library_device_jobs(device_id, status, created_at);

-- Pairing is one-time and atomic. Only the server service role can execute this function; the
-- plaintext pairing code and plaintext device credential never enter Postgres.
create or replace function public.claim_dj_library_pairing(
  p_code_hash text,
  p_public_id uuid,
  p_name text,
  p_platform text,
  p_app_version text,
  p_credential_hash text,
  p_credential_prefix text,
  p_capabilities jsonb
) returns table(device_id uuid, owner_id uuid, artist_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_artist_id uuid;
  v_device_id uuid;
begin
  select c.owner_id, c.artist_id
    into v_owner_id, v_artist_id
  from public.dj_library_pairing_codes c
  where c.code_hash = p_code_hash
    and c.used_at is null
    and c.expires_at > now()
  for update;

  if not found then
    raise exception 'invalid_or_expired_pairing_code' using errcode = 'P0001';
  end if;

  update public.dj_library_pairing_codes
     set used_at = now()
   where code_hash = p_code_hash;

  insert into public.dj_library_devices as d (
    owner_id, artist_id, public_id, name, platform, app_version,
    credential_hash, credential_prefix, capabilities, paired_at, last_seen_at, revoked_at
  ) values (
    v_owner_id, v_artist_id, p_public_id, left(trim(p_name), 120), p_platform,
    left(coalesce(nullif(trim(p_app_version), ''), 'unknown'), 80),
    p_credential_hash, left(p_credential_prefix, 16), coalesce(p_capabilities, '{}'::jsonb),
    now(), now(), null
  )
  on conflict (owner_id, artist_id, public_id) do update set
    name = excluded.name,
    platform = excluded.platform,
    app_version = excluded.app_version,
    credential_hash = excluded.credential_hash,
    credential_prefix = excluded.credential_prefix,
    capabilities = excluded.capabilities,
    paired_at = now(),
    last_seen_at = now(),
    revoked_at = null
  returning d.id into v_device_id;

  return query select v_device_id, v_owner_id, v_artist_id;
end;
$$;

-- Apply a fully staged target revision in one transaction. The source row remains on the previous
-- revision until every chunk exists, then tracks/removals and the source revision commit together.
create or replace function public.apply_dj_library_sync_revision(
  p_device_id uuid,
  p_source_id text,
  p_source_kind text,
  p_base_revision text,
  p_target_revision text,
  p_batch_count integer
) returns table(revision text, track_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_artist_id uuid;
  v_source_id uuid;
  v_current_revision text;
  v_current_count integer;
  v_chunk_count integer;
  v_chunk record;
  v_track jsonb;
  v_removed text;
begin
  select d.owner_id, d.artist_id
    into v_owner_id, v_artist_id
  from public.dj_library_devices d
  where d.id = p_device_id and d.revoked_at is null
  for update;

  if not found then
    raise exception 'device_not_active' using errcode = 'P0001';
  end if;

  select s.id, s.revision, s.track_count
    into v_source_id, v_current_revision, v_current_count
  from public.dj_library_device_sources s
  where s.device_id = p_device_id and s.source_id = p_source_id
  for update;

  if found and v_current_revision = p_target_revision then
    delete from public.dj_library_sync_chunks c
      where c.device_id = p_device_id and c.source_id = p_source_id and c.target_revision = p_target_revision;
    return query select p_target_revision, v_current_count;
    return;
  end if;

  if found then
    if v_current_revision is distinct from p_base_revision then
      raise exception 'source_revision_conflict' using errcode = 'P0001';
    end if;
  else
    if p_base_revision is not null then
      raise exception 'source_revision_conflict' using errcode = 'P0001';
    end if;
    insert into public.dj_library_device_sources (
      device_id, owner_id, artist_id, source_id, source_kind, revision, track_count
    ) values (
      p_device_id, v_owner_id, v_artist_id, p_source_id, p_source_kind, null, 0
    ) returning id into v_source_id;
  end if;

  select count(*)::integer into v_chunk_count
  from public.dj_library_sync_chunks c
  where c.device_id = p_device_id
    and c.source_id = p_source_id
    and c.target_revision = p_target_revision
    and c.batch_count = p_batch_count
    and c.batch_index >= 0
    and c.batch_index < p_batch_count;

  if v_chunk_count <> p_batch_count then
    raise exception 'sync_revision_incomplete' using errcode = 'P0001';
  end if;

  for v_chunk in
    select c.payload
    from public.dj_library_sync_chunks c
    where c.device_id = p_device_id
      and c.source_id = p_source_id
      and c.target_revision = p_target_revision
    order by c.batch_index asc
  loop
    for v_track in
      select value from jsonb_array_elements(coalesce(v_chunk.payload->'changedTracks', '[]'::jsonb))
    loop
      insert into public.dj_library_source_tracks as t (
        device_id, device_source_id, owner_id, artist_id, source_id, source_track_id,
        recording_fingerprint, metadata, playlist_ids, cue_points, beat_grid,
        analysis_provenance, availability, revision
      ) values (
        p_device_id, v_source_id, v_owner_id, v_artist_id, p_source_id,
        v_track->>'sourceTrackId', v_track->>'recordingFingerprint',
        coalesce(v_track->'metadata', '{}'::jsonb),
        coalesce(v_track->'playlistIds', '[]'::jsonb),
        coalesce(v_track->'cuePoints', '[]'::jsonb),
        v_track->'beatGrid',
        coalesce(v_track->'analysisProvenance', '[]'::jsonb),
        coalesce(nullif(v_track->>'availability', ''), 'unknown'),
        p_target_revision
      )
      on conflict (device_id, source_id, source_track_id) do update set
        device_source_id = excluded.device_source_id,
        recording_fingerprint = excluded.recording_fingerprint,
        metadata = excluded.metadata,
        playlist_ids = excluded.playlist_ids,
        cue_points = excluded.cue_points,
        beat_grid = excluded.beat_grid,
        analysis_provenance = excluded.analysis_provenance,
        availability = excluded.availability,
        revision = excluded.revision;
    end loop;

    for v_removed in
      select value from jsonb_array_elements_text(coalesce(v_chunk.payload->'removedSourceTrackIds', '[]'::jsonb))
    loop
      delete from public.dj_library_source_tracks t
      where t.device_id = p_device_id
        and t.source_id = p_source_id
        and t.source_track_id = v_removed;
    end loop;
  end loop;

  select count(*)::integer into v_current_count
  from public.dj_library_source_tracks t
  where t.device_id = p_device_id and t.source_id = p_source_id;

  update public.dj_library_device_sources s set
    source_kind = p_source_kind,
    revision = p_target_revision,
    track_count = v_current_count,
    last_synced_at = now()
  where s.id = v_source_id;

  delete from public.dj_library_sync_chunks c
  where c.device_id = p_device_id and c.source_id = p_source_id and c.target_revision = p_target_revision;

  return query select p_target_revision, v_current_count;
end;
$$;

-- Claim queued jobs safely across concurrent device polls. A stale claim becomes eligible again so
-- a bridge crash between claim and result submission cannot orphan work forever.
create or replace function public.claim_dj_library_device_jobs(
  p_device_id uuid,
  p_limit integer default 8
) returns table(
  id uuid,
  idempotency_key text,
  job_type text,
  source_revision text,
  payload jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.dj_library_devices d
    where d.id = p_device_id and d.revoked_at is null
  ) then
    raise exception 'device_not_active' using errcode = 'P0001';
  end if;

  return query
  with candidates as (
    select j.id
    from public.dj_library_device_jobs j
    where j.device_id = p_device_id
      and (
        j.status = 'queued'
        or (j.status = 'claimed' and j.claimed_at < now() - interval '2 minutes')
      )
    order by j.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 8), 20))
  )
  update public.dj_library_device_jobs j set
    status = 'claimed',
    claimed_at = now()
  from candidates c
  where j.id = c.id
  returning j.id, j.idempotency_key, j.job_type, j.source_revision, j.payload;
end;
$$;

-- Defense in depth: all rows remain artist/owner scoped even though device mutation endpoints use
-- a server-side service client after authenticating a high-entropy device credential.
alter table public.dj_library_devices enable row level security;
alter table public.dj_library_pairing_codes enable row level security;
alter table public.dj_library_device_sources enable row level security;
alter table public.dj_library_source_tracks enable row level security;
alter table public.dj_library_sync_chunks enable row level security;
alter table public.dj_library_device_jobs enable row level security;

create policy "dj_library_devices_select_own"
  on public.dj_library_devices for select to authenticated
  using (auth.uid() = owner_id and private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "dj_library_device_sources_select_own"
  on public.dj_library_device_sources for select to authenticated
  using (auth.uid() = owner_id and private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "dj_library_source_tracks_select_own"
  on public.dj_library_source_tracks for select to authenticated
  using (auth.uid() = owner_id and private.is_studio_admin() and private.can_access_artist(artist_id));
create policy "dj_library_device_jobs_select_own"
  on public.dj_library_device_jobs for select to authenticated
  using (auth.uid() = owner_id and private.is_studio_admin() and private.can_access_artist(artist_id));

-- Never expose device credential hashes, pairing-code hashes or staging chunks to browser clients.
revoke all on public.dj_library_devices from anon, authenticated;
grant select (id, owner_id, artist_id, public_id, name, platform, app_version, credential_prefix, capabilities, paired_at, last_seen_at, revoked_at, created_at, updated_at)
  on public.dj_library_devices to authenticated;

revoke all on public.dj_library_pairing_codes from anon, authenticated;
revoke all on public.dj_library_device_sources from anon, authenticated;
grant select on public.dj_library_device_sources to authenticated;
revoke all on public.dj_library_source_tracks from anon, authenticated;
grant select on public.dj_library_source_tracks to authenticated;
revoke all on public.dj_library_sync_chunks from anon, authenticated;
revoke all on public.dj_library_device_jobs from anon, authenticated;
grant select on public.dj_library_device_jobs to authenticated;

grant all on public.dj_library_devices to service_role;
grant all on public.dj_library_pairing_codes to service_role;
grant all on public.dj_library_device_sources to service_role;
grant all on public.dj_library_source_tracks to service_role;
grant all on public.dj_library_sync_chunks to service_role;
grant all on public.dj_library_device_jobs to service_role;

revoke all on function public.claim_dj_library_pairing(text, uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_dj_library_pairing(text, uuid, text, text, text, text, text, jsonb) to service_role;
revoke all on function public.apply_dj_library_sync_revision(uuid, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.apply_dj_library_sync_revision(uuid, text, text, text, text, integer) to service_role;
revoke all on function public.claim_dj_library_device_jobs(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_dj_library_device_jobs(uuid, integer) to service_role;

drop trigger if exists set_dj_library_devices_updated_at on public.dj_library_devices;
create trigger set_dj_library_devices_updated_at
  before update on public.dj_library_devices
  for each row execute function private.set_updated_at();

drop trigger if exists set_dj_library_device_sources_updated_at on public.dj_library_device_sources;
create trigger set_dj_library_device_sources_updated_at
  before update on public.dj_library_device_sources
  for each row execute function private.set_updated_at();

drop trigger if exists set_dj_library_source_tracks_updated_at on public.dj_library_source_tracks;
create trigger set_dj_library_source_tracks_updated_at
  before update on public.dj_library_source_tracks
  for each row execute function private.set_updated_at();

drop trigger if exists set_dj_library_device_jobs_updated_at on public.dj_library_device_jobs;
create trigger set_dj_library_device_jobs_updated_at
  before update on public.dj_library_device_jobs
  for each row execute function private.set_updated_at();

comment on table public.dj_library_devices is
  'Revocable native Library Bridge devices. Credential hashes are server-only and local filesystem paths never enter this table.';
comment on table public.dj_library_source_tracks is
  'Path-free normalized DJ-library evidence synchronized from a paired device. A source revision changes only after its complete staged delta applies.';
comment on table public.dj_library_sync_chunks is
  'Ephemeral path-free staging for atomic Library Bridge revision application. Browser clients have no access.';
comment on table public.dj_library_device_jobs is
  'Durable idempotent work for a paired native bridge. Job payloads must never contain local filesystem paths.';
