begin;

create table if not exists public.ensemblis_perpetual_licenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  major_version integer not null check (major_version > 0),
  device_limit integer not null default 3 check (device_limit between 1 and 20),
  active boolean not null default true,
  purchased_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, major_version)
);

create table if not exists public.ensemblis_license_activations (
  license_id uuid not null references public.ensemblis_perpetual_licenses(id) on delete cascade,
  device_id uuid not null references public.dj_library_devices(id) on delete cascade,
  owner_id uuid not null,
  activated_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (license_id, device_id)
);
create index if not exists ensemblis_license_activations_owner_idx
  on public.ensemblis_license_activations(owner_id, revoked_at);

create table if not exists public.ensemblis_capability_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  capability text not null check (length(capability) between 1 and 120),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, capability)
);
create index if not exists ensemblis_capability_grants_owner_idx
  on public.ensemblis_capability_grants(owner_id, expires_at);

create table if not exists public.ensemblis_model_catalog (
  id text not null check (id ~ '^[a-z0-9][a-z0-9._-]{1,119}$'),
  version text not null check (length(version) between 1 and 80),
  platform text not null check (platform in ('windows','macos','linux')),
  architecture text not null check (architecture in ('x86_64','aarch64')),
  url text not null check (url ~ '^https://'),
  sha256 text not null check (sha256 ~ '^sha256:[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 21474836480),
  required_capability text check (required_capability is null or length(required_capability) between 1 and 120),
  metadata jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, version, platform, architecture)
);

create table if not exists public.ensemblis_execution_telemetry (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  task_id text not null check (length(task_id) between 1 and 200),
  processor_id text not null check (length(processor_id) between 1 and 160),
  processor_version text not null check (length(processor_version) between 1 and 160),
  target text not null check (target in ('local_sidecar','cloud','browser')),
  started_at timestamptz not null,
  duration_ms bigint not null check (duration_ms >= 0),
  queue_ms bigint check (queue_ms is null or queue_ms >= 0),
  input_bytes bigint not null default 0 check (input_bytes >= 0),
  output_bytes bigint not null default 0 check (output_bytes >= 0),
  cpu_ms bigint check (cpu_ms is null or cpu_ms >= 0),
  gpu_ms bigint check (gpu_ms is null or gpu_ms >= 0),
  hardware_class text,
  provider text,
  estimated_cost_microunits bigint check (estimated_cost_microunits is null or estimated_cost_microunits >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);
create index if not exists ensemblis_execution_telemetry_owner_started_idx
  on public.ensemblis_execution_telemetry(owner_id, started_at desc);

alter table public.ensemblis_perpetual_licenses enable row level security;
alter table public.ensemblis_license_activations enable row level security;
alter table public.ensemblis_capability_grants enable row level security;
alter table public.ensemblis_model_catalog enable row level security;
alter table public.ensemblis_execution_telemetry enable row level security;

revoke all on public.ensemblis_perpetual_licenses from anon, authenticated;
revoke all on public.ensemblis_license_activations from anon, authenticated;
revoke all on public.ensemblis_capability_grants from anon, authenticated;
revoke all on public.ensemblis_model_catalog from anon, authenticated;
revoke all on public.ensemblis_execution_telemetry from anon, authenticated;
grant select, insert, update, delete on public.ensemblis_perpetual_licenses to service_role;
grant select, insert, update, delete on public.ensemblis_license_activations to service_role;
grant select, insert, update, delete on public.ensemblis_capability_grants to service_role;
grant select, insert, update, delete on public.ensemblis_model_catalog to service_role;
grant select, insert on public.ensemblis_execution_telemetry to service_role;

create or replace function public.activate_ensemblis_perpetual_license(
  p_owner_id uuid,
  p_device_id uuid,
  p_major_version integer
)
returns table(license_id uuid, activated boolean, device_limit integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_license public.ensemblis_perpetual_licenses%rowtype;
  v_active_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  select * into v_license
  from public.ensemblis_perpetual_licenses
  where owner_id = p_owner_id
    and major_version = p_major_version
    and active = true
  for update;

  if not found then
    return;
  end if;

  if exists (
    select 1 from public.ensemblis_license_activations
    where license_id = v_license.id
      and device_id = p_device_id
      and revoked_at is null
  ) then
    return query select v_license.id, true, v_license.device_limit;
    return;
  end if;

  select count(*)::integer into v_active_count
  from public.ensemblis_license_activations
  where license_id = v_license.id
    and revoked_at is null;

  if v_active_count >= v_license.device_limit then
    raise exception 'ensemblis_device_limit_reached';
  end if;

  insert into public.ensemblis_license_activations(license_id, device_id, owner_id, activated_at, revoked_at)
  values (v_license.id, p_device_id, p_owner_id, now(), null)
  on conflict (license_id, device_id) do update
    set owner_id = excluded.owner_id,
        activated_at = now(),
        revoked_at = null;

  return query select v_license.id, true, v_license.device_limit;
end;
$$;

revoke all on function public.activate_ensemblis_perpetual_license(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.activate_ensemblis_perpetual_license(uuid, uuid, integer) to service_role;

-- Existing paired desktop users are grandfathered into Studio v1 so this migration never
-- silently removes local processing from an already-working installation.
insert into public.ensemblis_perpetual_licenses(owner_id, major_version, device_limit, active)
select distinct owner_id, 1, 3, true
from public.dj_library_devices
where revoked_at is null
on conflict (owner_id, major_version) do nothing;

-- Cloud compute becomes capability-gated at the same time as this migration. Owners with existing
-- cloud workloads receive a short migration window so queued/current product flows are not cut off
-- abruptly. Commercial/account provisioning must create or renew explicit grants after this window.
insert into public.ensemblis_capability_grants(owner_id, capability, expires_at)
select owner_id, 'cloud.compute', now() + interval '30 days'
from (
  select distinct owner_id from public.music_video_worker_jobs where owner_id is not null
  union
  select distinct owner_id from public.track_stem_jobs where owner_id is not null
  union
  select distinct owner_id from public.track_vault where owner_id is not null
) existing_cloud_owners
on conflict (owner_id, capability) do update
set expires_at = case
  when public.ensemblis_capability_grants.expires_at is null then null
  else greatest(public.ensemblis_capability_grants.expires_at, excluded.expires_at)
end,
updated_at = now();

commit;
