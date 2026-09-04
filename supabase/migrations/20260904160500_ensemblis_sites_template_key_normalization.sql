-- Normalize the original prototype key to the stable template identity.
-- Version belongs in artist_site_versions.template_version, not in the key string.

update public.artist_sites
set template_key = 'artist-editorial'
where template_key = 'artist-editorial-v1';

update public.artist_site_versions
set template_key = 'artist-editorial'
where template_key = 'artist-editorial-v1';

alter table public.artist_sites
  alter column template_key set default 'artist-editorial';

-- Keep the site-level convenience pointer aligned with the template pinned by the
-- newly published version. Public rendering still reads template lineage from the
-- immutable version, never from this mutable summary field.
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
      template_key = version_row.template_key,
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
