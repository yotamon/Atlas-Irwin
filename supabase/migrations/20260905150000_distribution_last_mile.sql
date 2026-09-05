-- Ensemblis Distribution last mile.
-- Keep artist-facing release identity canonical and provider-neutral. Provider catalog IDs,
-- package IDs and store-specific contributor identifiers remain adapter details.

create table public.distribution_release_metadata (
  release_id uuid primary key references public.releases(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete restrict,
  metadata_language_code text not null default 'en' check (char_length(metadata_language_code) between 2 and 16),
  label_name text not null default '',
  catalog_number text,
  product_copyright_line text not null default '',
  recording_copyright_line text not null default '',
  upc_source text not null default 'provider' check (upc_source in ('provider','artist')),
  upc_status text not null default 'unassigned' check (upc_status in ('unassigned','pending','assigned','verified')),
  upc text,
  original_release_date date,
  preorder_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (upc is null or upc ~ '^[0-9]{12,14}$'),
  check (upc_source <> 'artist' or upc is not null),
  check (preorder_date is null or original_release_date is null or preorder_date <= original_release_date)
);

create index distribution_release_metadata_artist_idx
  on public.distribution_release_metadata(owner_id, artist_id, updated_at desc);
create unique index distribution_release_metadata_upc_idx
  on public.distribution_release_metadata(upc)
  where upc is not null and upc_status in ('assigned','verified');

create or replace function private.validate_distribution_release_metadata_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_artist uuid;
begin
  select owner_id, artist_id into v_owner, v_artist
  from public.releases
  where id = new.release_id;

  if v_owner is null or v_artist is null then
    raise exception 'Distribution release metadata requires a canonical release';
  end if;
  if new.owner_id <> v_owner or new.artist_id <> v_artist then
    raise exception 'Distribution release metadata must match the release owner and artist';
  end if;
  perform private.assert_operational_artist_owner(new.owner_id, new.artist_id);
  return new;
end;
$$;
revoke all on function private.validate_distribution_release_metadata_scope() from public, anon, authenticated;

create trigger distribution_release_metadata_validate_scope
  before insert or update on public.distribution_release_metadata
  for each row execute function private.validate_distribution_release_metadata_scope();
create trigger set_distribution_release_metadata_updated_at
  before update on public.distribution_release_metadata
  for each row execute function private.set_updated_at();

alter table public.distribution_release_metadata enable row level security;
revoke all on public.distribution_release_metadata from anon, authenticated;
grant select,insert,update,delete on public.distribution_release_metadata to authenticated;

create policy distribution_release_metadata_select
  on public.distribution_release_metadata for select to authenticated
  using (owner_id = auth.uid() and private.can_access_artist(artist_id));
create policy distribution_release_metadata_insert
  on public.distribution_release_metadata for insert to authenticated
  with check (owner_id = auth.uid() and private.can_access_artist(artist_id));
create policy distribution_release_metadata_update
  on public.distribution_release_metadata for update to authenticated
  using (owner_id = auth.uid() and private.can_access_artist(artist_id))
  with check (owner_id = auth.uid() and private.can_access_artist(artist_id));
create policy distribution_release_metadata_delete
  on public.distribution_release_metadata for delete to authenticated
  using (owner_id = auth.uid() and private.can_access_artist(artist_id));

revoke all on public.distribution_release_metadata from service_role;
grant all on public.distribution_release_metadata to service_role;

-- Provision a provider-assigned UPC lifecycle row for every existing release without inventing
-- artist declarations. Empty copyright/label fields intentionally remain exact blockers.
insert into public.distribution_release_metadata (
  release_id, owner_id, artist_id, metadata_language_code, upc_source, upc_status
)
select r.id, r.owner_id, r.artist_id, 'en', 'provider', 'unassigned'
from public.releases r
where r.artist_id is not null
on conflict (release_id) do nothing;

create or replace function private.provision_distribution_release_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.artist_id is not null then
    insert into public.distribution_release_metadata(release_id, owner_id, artist_id)
    values(new.id, new.owner_id, new.artist_id)
    on conflict (release_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.provision_distribution_release_metadata() from public, anon, authenticated;
create trigger releases_provision_distribution_metadata
  after insert on public.releases
  for each row execute function private.provision_distribution_release_metadata();

comment on table public.distribution_release_metadata is
  'Provider-neutral release-level distribution identity. Legal declarations remain in release_distribution_configs; provider IDs remain adapter details.';
comment on column public.distribution_release_metadata.upc_source is
  'provider means Ensemblis may request provider assignment; artist means the artist supplied the canonical UPC.';
