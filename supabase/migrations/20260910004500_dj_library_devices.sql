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

-- Defense in depth: all rows remain artist/owner scoped even though device mutation endpoints use
-- a server-side service client after authenticating a high-entropy device credential.
alter table public.dj_library_devices enable row level security;
alter table public.dj_library_pairing_codes enable row level security;
alter table public.dj_library_device_sources enable row level security;
alter table public.dj_library_source_tracks enable row level security;
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

-- Never expose the device credential hash to authenticated browser clients. Studio receives only
-- safe device metadata through the normal row policy / column grants.
revoke all on public.dj_library_devices from anon, authenticated;
grant select (id, owner_id, artist_id, public_id, name, platform, app_version, credential_prefix, capabilities, paired_at, last_seen_at, revoked_at, created_at, updated_at)
  on public.dj_library_devices to authenticated;

revoke all on public.dj_library_pairing_codes from anon, authenticated;
revoke all on public.dj_library_device_sources from anon, authenticated;
grant select on public.dj_library_device_sources to authenticated;
revoke all on public.dj_library_source_tracks from anon, authenticated;
grant select on public.dj_library_source_tracks to authenticated;
revoke all on public.dj_library_device_jobs from anon, authenticated;
grant select on public.dj_library_device_jobs to authenticated;

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
  'Path-free normalized DJ-library evidence synchronized from a paired device.';
comment on table public.dj_library_device_jobs is
  'Durable idempotent work for a paired native bridge. Job payloads must never contain local filesystem paths.';
