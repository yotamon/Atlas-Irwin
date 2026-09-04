-- Domain lifecycle metadata and narrow public hostname resolution for Ensemblis Sites.
-- This migration does not activate any existing pending domain.

alter table public.artist_site_domains
  add column if not exists provider text,
  add column if not exists provider_ref text,
  add column if not exists verification_state jsonb not null default '{}'::jsonb,
  add column if not exists last_checked_at timestamptz;

alter table public.artist_site_domains
  add constraint artist_site_domains_verification_state_object
  check (jsonb_typeof(verification_state) = 'object');

create or replace function public.set_artist_site_primary_domain(
  target_site_id uuid,
  target_domain_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  site_row public.artist_sites%rowtype;
  domain_row public.artist_site_domains%rowtype;
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

  if site_row.state <> 'published' or site_row.published_version_id is null then
    raise exception 'site must be published before selecting a primary domain';
  end if;

  select * into domain_row
  from public.artist_site_domains
  where id = target_domain_id
    and site_id = site_row.id
  for update;

  if not found then
    raise exception 'domain not found for site';
  end if;

  if domain_row.verification_status <> 'verified' or domain_row.ssl_status <> 'active' then
    raise exception 'domain must be verified with active TLS before becoming primary';
  end if;

  update public.artist_site_domains
  set is_primary = false
  where site_id = site_row.id
    and id <> domain_row.id
    and is_primary = true;

  update public.artist_site_domains
  set is_primary = true
  where id = domain_row.id;

  return domain_row.id;
end
$$;

revoke all on function public.set_artist_site_primary_domain(uuid, uuid) from public, anon;
grant execute on function public.set_artist_site_primary_domain(uuid, uuid) to authenticated;

-- Proxy-safe resolver. It intentionally exposes only non-secret routing identifiers
-- for domains that are fully active. Canonical rendering validates the site again.
create or replace function public.resolve_artist_site_hostname(target_hostname text)
returns table (
  site_id uuid,
  site_slug text
)
language sql
stable
security definer
set search_path = ''
as $$
  select site.id, site.slug
  from public.artist_site_domains domain
  join public.artist_sites site on site.id = domain.site_id
  join public.artist_site_versions version on version.id = site.published_version_id
  where domain.hostname = lower(trim(trailing '.' from target_hostname))
    and domain.verification_status = 'verified'
    and domain.ssl_status = 'active'
    and site.state = 'published'
    and site.published_version_id is not null
    and version.site_id = site.id
    and version.status = 'published'
  limit 1
$$;

revoke all on function public.resolve_artist_site_hostname(text) from public;
grant execute on function public.resolve_artist_site_hostname(text) to anon, authenticated;
