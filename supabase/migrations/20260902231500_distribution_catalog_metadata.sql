-- Complete Ensemblis Distribution catalog metadata and safe provider preparation.
-- These tables are provider-neutral. Revelator IDs remain external references only.

create table public.distribution_track_metadata (
  track_id uuid primary key references public.tracks(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  metadata_language_code text not null default 'en',
  audio_language_code text not null default 'en',
  explicit boolean not null default false,
  track_origin text not null default 'original' check (track_origin in ('original','cover','public_domain')),
  isrc text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.distribution_track_writers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  legal_name text not null,
  role text not null check (role in ('composer','lyricist','composer_lyricist')),
  share numeric(5,2) not null check (share > 0 and share <= 100),
  publishing_type text not null default 'copyright_control' check (publishing_type in ('copyright_control','published','public_domain')),
  publisher_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(track_id, legal_name, role)
);

create table public.distribution_track_contributors (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  name text not null,
  role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(track_id, name, role)
);

create table public.distribution_provider_operations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  release_id uuid not null references public.releases(id) on delete cascade,
  provider text not null,
  operation_type text not null check (operation_type in ('prepare_catalog','submit','update_catalog','takedown')),
  operation_key text not null,
  state text not null default 'started' check (state in ('started','completed','failed_safe','ambiguous','resolved')),
  request_snapshot jsonb not null default '{}'::jsonb,
  result_snapshot jsonb not null default '{}'::jsonb,
  provider_resource_id text,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, operation_key)
);

create index distribution_track_metadata_owner_idx on public.distribution_track_metadata(owner_id);
create index distribution_track_writers_track_idx on public.distribution_track_writers(track_id);
create index distribution_track_contributors_track_idx on public.distribution_track_contributors(track_id);
create index distribution_provider_operations_release_idx on public.distribution_provider_operations(release_id, created_at desc);
create index distribution_provider_operations_ambiguous_idx on public.distribution_provider_operations(owner_id, release_id, operation_type, state) where state in ('started','ambiguous');

-- Writer shares must total 100 per track before provider preparation. The application enforces
-- this transactionally at the workflow boundary because rows are edited independently in the UI.

alter table public.distribution_track_metadata enable row level security;
alter table public.distribution_track_writers enable row level security;
alter table public.distribution_track_contributors enable row level security;
alter table public.distribution_provider_operations enable row level security;

do $$ declare t text; begin
  foreach t in array array['distribution_track_metadata','distribution_track_writers','distribution_track_contributors','distribution_provider_operations'] loop
    execute format('create policy "admins select own %1$s" on public.%1$I for select to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins insert own %1$s" on public.%1$I for insert to authenticated with check (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins update own %1$s" on public.%1$I for update to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin()) with check (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins delete own %1$s" on public.%1$I for delete to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['distribution_track_metadata','distribution_track_writers','distribution_track_contributors','distribution_provider_operations'] loop
    execute format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

grant select,insert,update,delete on public.distribution_track_metadata, public.distribution_track_writers, public.distribution_track_contributors to authenticated;
grant select,insert,update on public.distribution_provider_operations to authenticated;
revoke all on public.distribution_track_metadata, public.distribution_track_writers, public.distribution_track_contributors, public.distribution_provider_operations from anon;
