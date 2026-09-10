-- Ensemblis Visual Brand DNA: artist-local, versioned visual identity built from approved media evidence.
-- Reuse media_assets for source/reference files; this table stores only the synthesized identity state.

create table if not exists public.artist_visual_brand_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  maturity text not null default 'emerging' check (maturity in ('starting', 'emerging', 'established')),
  use_cases text[] not null default '{}'::text[],
  source_asset_ids uuid[] not null default '{}'::uuid[],
  canonical_asset_ids uuid[] not null default '{}'::uuid[],
  dna jsonb not null default '{}'::jsonb check (jsonb_typeof(dna) = 'object'),
  analysis jsonb not null default '{}'::jsonb check (jsonb_typeof(analysis) = 'object'),
  confidence numeric(5,4) not null default 0 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (artist_id, version)
);

create unique index if not exists artist_visual_brand_one_active_idx
  on public.artist_visual_brand_versions(artist_id)
  where status = 'active';

create index if not exists artist_visual_brand_versions_artist_idx
  on public.artist_visual_brand_versions(artist_id, status, version desc);

create trigger set_artist_visual_brand_versions_updated_at
  before update on public.artist_visual_brand_versions
  for each row execute function private.set_updated_at();

alter table public.artist_visual_brand_versions enable row level security;

create policy "studio admins read accessible visual brand versions"
  on public.artist_visual_brand_versions
  for select
  to authenticated
  using (private.is_studio_admin() and private.can_access_artist(artist_id));

create policy "studio admins create accessible visual brand versions"
  on public.artist_visual_brand_versions
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

create policy "studio admins update accessible visual brand versions"
  on public.artist_visual_brand_versions
  for update
  to authenticated
  using (private.is_studio_admin() and private.can_access_artist(artist_id))
  with check (private.is_studio_admin() and private.can_access_artist(artist_id));

create policy "studio admins delete accessible visual brand drafts"
  on public.artist_visual_brand_versions
  for delete
  to authenticated
  using (
    status <> 'active'
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

revoke all on public.artist_visual_brand_versions from anon, authenticated;
grant select, insert, update, delete on public.artist_visual_brand_versions to authenticated;
