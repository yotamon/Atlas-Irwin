-- Ensemblis Sites foundation.
-- Additive and reversible: this creates the owned-web persistence layer without
-- changing the existing Atlas Irwin public runtime or DNS.

create table public.artist_sites (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete restrict,
  slug text not null check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  template_key text not null default 'artist-editorial-v1' check (length(trim(template_key)) > 0),
  state text not null default 'draft' check (state in ('draft','published','archived')),
  published_version_id uuid,
  draft_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_id),
  unique (slug)
);

create table public.artist_site_versions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.artist_sites(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft','published','superseded')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  content_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(content_snapshot) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (site_id, version_number)
);

alter table public.artist_sites
  add constraint artist_sites_published_version_fk
  foreign key (published_version_id) references public.artist_site_versions(id) on delete set null deferrable initially deferred,
  add constraint artist_sites_draft_version_fk
  foreign key (draft_version_id) references public.artist_site_versions(id) on delete set null deferrable initially deferred;

create table public.artist_site_domains (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.artist_sites(id) on delete cascade,
  hostname text not null check (
    hostname = lower(hostname)
    and hostname !~ '[:/]'
    and hostname ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
  ),
  domain_type text not null check (domain_type in ('managed','custom')),
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','failed')),
  ssl_status text not null default 'pending' check (ssl_status in ('pending','active','failed')),
  is_primary boolean not null default false,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hostname)
);

create table public.artist_site_deployments (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.artist_sites(id) on delete cascade,
  version_id uuid not null references public.artist_site_versions(id) on delete cascade,
  provider text not null default 'shared-runtime',
  provider_ref text,
  status text not null default 'requested' check (status in ('requested','building','ready','failed','rolled_back')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index artist_sites_artist_state_idx on public.artist_sites(artist_id, state);
create index artist_site_versions_site_status_idx on public.artist_site_versions(site_id, status, version_number desc);
create index artist_site_domains_site_idx on public.artist_site_domains(site_id, is_primary desc);
create index artist_site_deployments_site_idx on public.artist_site_deployments(site_id, requested_at desc);
create unique index artist_site_one_primary_domain_idx on public.artist_site_domains(site_id) where is_primary;

create trigger set_artist_sites_updated_at
  before update on public.artist_sites
  for each row execute function private.set_updated_at();
create trigger set_artist_site_domains_updated_at
  before update on public.artist_site_domains
  for each row execute function private.set_updated_at();

-- Child-table RLS can use this helper without recursively evaluating site policies.
create or replace function private.can_access_artist_site(target_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.artist_sites site
    where site.id = target_site_id
      and private.can_access_artist(site.artist_id)
  )
$$;

revoke all on function private.can_access_artist_site(uuid) from public, anon;
grant execute on function private.can_access_artist_site(uuid) to authenticated;

-- A site may only point at versions that belong to itself.
create or replace function private.validate_artist_site_version_pointers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.published_version_id is not null and not exists (
    select 1 from public.artist_site_versions version
    where version.id = new.published_version_id and version.site_id = new.id
  ) then
    raise exception 'published_version_id must belong to the same artist site';
  end if;

  if new.draft_version_id is not null and not exists (
    select 1 from public.artist_site_versions version
    where version.id = new.draft_version_id and version.site_id = new.id
  ) then
    raise exception 'draft_version_id must belong to the same artist site';
  end if;

  return new;
end
$$;

create constraint trigger validate_artist_site_version_pointers
  after insert or update of published_version_id, draft_version_id on public.artist_sites
  deferrable initially deferred
  for each row execute function private.validate_artist_site_version_pointers();

-- Published content is an immutable snapshot. Lifecycle status may advance from
-- published to superseded, but the payload and lineage cannot be rewritten.
create or replace function private.protect_published_artist_site_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.status in ('published','superseded') then
    raise exception 'published artist site versions are immutable';
  end if;

  if tg_op = 'UPDATE' and old.status in ('published','superseded') and (
    new.site_id is distinct from old.site_id
    or new.version_number is distinct from old.version_number
    or new.config is distinct from old.config
    or new.content_snapshot is distinct from old.content_snapshot
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.published_at is distinct from old.published_at
  ) then
    raise exception 'published artist site snapshots cannot be mutated';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger protect_published_artist_site_version
  before update or delete on public.artist_site_versions
  for each row execute function private.protect_published_artist_site_version();

alter table public.artist_sites enable row level security;
alter table public.artist_site_versions enable row level security;
alter table public.artist_site_domains enable row level security;
alter table public.artist_site_deployments enable row level security;

create policy "studio admins manage accessible artist sites"
  on public.artist_sites for all to authenticated
  using (private.is_studio_admin() and private.can_access_artist(artist_id))
  with check (private.is_studio_admin() and private.can_access_artist(artist_id));

create policy "studio admins manage accessible site versions"
  on public.artist_site_versions for all to authenticated
  using (private.is_studio_admin() and private.can_access_artist_site(site_id))
  with check (private.is_studio_admin() and private.can_access_artist_site(site_id));

create policy "studio admins manage accessible site domains"
  on public.artist_site_domains for all to authenticated
  using (private.is_studio_admin() and private.can_access_artist_site(site_id))
  with check (private.is_studio_admin() and private.can_access_artist_site(site_id));

create policy "studio admins manage accessible site deployments"
  on public.artist_site_deployments for all to authenticated
  using (private.is_studio_admin() and private.can_access_artist_site(site_id))
  with check (private.is_studio_admin() and private.can_access_artist_site(site_id));

revoke all on public.artist_sites from anon, authenticated;
revoke all on public.artist_site_versions from anon, authenticated;
revoke all on public.artist_site_domains from anon, authenticated;
revoke all on public.artist_site_deployments from anon, authenticated;

grant select, insert, update, delete on public.artist_sites to authenticated;
grant select, insert, update, delete on public.artist_site_versions to authenticated;
grant select, insert, update, delete on public.artist_site_domains to authenticated;
grant select, insert, update, delete on public.artist_site_deployments to authenticated;

-- Publish is an atomic lifecycle transition: the previous version is superseded,
-- the target snapshot is frozen as published, the site pointer moves, and a shared-
-- runtime deployment record is written in the same transaction.
create or replace function public.publish_artist_site(
  target_site_id uuid,
  target_version_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  site_row public.artist_sites%rowtype;
  version_row public.artist_site_versions%rowtype;
begin
  if (select auth.uid()) is null or not private.is_studio_admin() then
    raise exception 'not authorized';
  end if;

  select * into site_row
  from public.artist_sites
  where id = target_site_id
  for update;

  if not found or not private.can_access_artist(site_row.artist_id) then
    raise exception 'artist site not accessible';
  end if;

  select * into version_row
  from public.artist_site_versions
  where id = target_version_id
    and site_id = target_site_id
    and status = 'draft'
  for update;

  if not found then
    raise exception 'draft version not found';
  end if;

  if site_row.published_version_id is not null then
    update public.artist_site_versions
    set status = 'superseded'
    where id = site_row.published_version_id
      and status = 'published';
  end if;

  update public.artist_site_versions
  set status = 'published', published_at = now()
  where id = version_row.id;

  update public.artist_sites
  set state = 'published',
      published_version_id = version_row.id,
      draft_version_id = null
  where id = site_row.id;

  insert into public.artist_site_deployments (
    site_id, version_id, provider, status, completed_at
  ) values (
    site_row.id, version_row.id, 'shared-runtime', 'ready', now()
  );

  return version_row.id;
end
$$;

create or replace function public.create_artist_site_draft(target_site_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  site_row public.artist_sites%rowtype;
  source_row public.artist_site_versions%rowtype;
  next_version integer;
  new_version_id uuid;
begin
  if (select auth.uid()) is null or not private.is_studio_admin() then
    raise exception 'not authorized';
  end if;

  select * into site_row
  from public.artist_sites
  where id = target_site_id
  for update;

  if not found or not private.can_access_artist(site_row.artist_id) then
    raise exception 'artist site not accessible';
  end if;
  if site_row.draft_version_id is not null then
    return site_row.draft_version_id;
  end if;
  if site_row.published_version_id is null then
    raise exception 'published source version not found';
  end if;

  select * into source_row
  from public.artist_site_versions
  where id = site_row.published_version_id and site_id = site_row.id;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.artist_site_versions
  where site_id = site_row.id;

  insert into public.artist_site_versions (
    site_id, version_number, status, config, content_snapshot, created_by
  ) values (
    site_row.id, next_version, 'draft', source_row.config, source_row.content_snapshot, (select auth.uid())
  ) returning id into new_version_id;

  update public.artist_sites
  set draft_version_id = new_version_id
  where id = site_row.id;

  return new_version_id;
end
$$;

create or replace function public.rollback_artist_site(
  target_site_id uuid,
  source_version_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  site_row public.artist_sites%rowtype;
  source_row public.artist_site_versions%rowtype;
  next_version integer;
  rollback_version_id uuid;
begin
  if (select auth.uid()) is null or not private.is_studio_admin() then
    raise exception 'not authorized';
  end if;

  select * into site_row
  from public.artist_sites
  where id = target_site_id
  for update;

  if not found or not private.can_access_artist(site_row.artist_id) then
    raise exception 'artist site not accessible';
  end if;

  select * into source_row
  from public.artist_site_versions
  where id = source_version_id
    and site_id = site_row.id
    and status in ('published','superseded');

  if not found then
    raise exception 'rollback source version not found';
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.artist_site_versions
  where site_id = site_row.id;

  if site_row.published_version_id is not null then
    update public.artist_site_versions
    set status = 'superseded'
    where id = site_row.published_version_id and status = 'published';
  end if;

  insert into public.artist_site_versions (
    site_id, version_number, status, config, content_snapshot, created_by, published_at
  ) values (
    site_row.id, next_version, 'published', source_row.config, source_row.content_snapshot, (select auth.uid()), now()
  ) returning id into rollback_version_id;

  update public.artist_sites
  set state = 'published',
      published_version_id = rollback_version_id,
      draft_version_id = null
  where id = site_row.id;

  insert into public.artist_site_deployments (
    site_id, version_id, provider, provider_ref, status, completed_at
  ) values (
    site_row.id, rollback_version_id, 'shared-runtime', source_version_id::text, 'ready', now()
  );

  return rollback_version_id;
end
$$;

revoke all on function public.publish_artist_site(uuid, uuid) from public, anon;
revoke all on function public.create_artist_site_draft(uuid) from public, anon;
revoke all on function public.rollback_artist_site(uuid, uuid) from public, anon;
grant execute on function public.publish_artist_site(uuid, uuid) to authenticated;
grant execute on function public.create_artist_site_draft(uuid) to authenticated;
grant execute on function public.rollback_artist_site(uuid, uuid) to authenticated;
