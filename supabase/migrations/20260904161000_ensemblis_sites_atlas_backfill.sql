-- Map the existing Atlas Irwin production artist into the generic Sites model.
-- This is deliberately a shadow/draft backfill: it does not activate hostname
-- routing, change DNS, or replace the legacy public root renderer.

do $$
declare
  atlas_artist public.artists%rowtype;
  atlas_site public.artist_sites%rowtype;
  atlas_version_id uuid;
  existing_domain_site_id uuid;
  next_version integer;
begin
  -- Prefer the canonical artist that already owns Atlas release rows. Fall back to
  -- the artist name only for a pre-catalog/empty-catalog environment.
  select artist.* into atlas_artist
  from public.artists artist
  where artist.status = 'active'
    and lower(trim(artist.name)) = 'atlas irwin'
    and (
      artist.legacy_owner_id is not null
      or exists (
        select 1
        from public.releases release
        where release.artist_id = artist.id
          and lower(trim(release.artist)) = 'atlas irwin'
      )
    )
  order by
    case when exists (
      select 1 from public.releases release
      where release.artist_id = artist.id
        and lower(trim(release.artist)) = 'atlas irwin'
    ) then 0 else 1 end,
    artist.created_at
  limit 1;

  if atlas_artist.id is null then
    return;
  end if;

  select * into atlas_site
  from public.artist_sites
  where artist_id = atlas_artist.id;

  if atlas_site.id is null then
    insert into public.artist_sites (
      artist_id,
      slug,
      template_key,
      state
    ) values (
      atlas_artist.id,
      'atlas-irwin',
      'artist-editorial',
      'draft'
    )
    returning * into atlas_site;
  end if;

  -- Do not manufacture another draft if the site already has any lifecycle state.
  -- Fresh installs receive one fully valid, previewable skeleton snapshot that can
  -- later be refreshed from current canonical data by Studio.
  if atlas_site.draft_version_id is null
     and atlas_site.published_version_id is null
     and not exists (
       select 1 from public.artist_site_versions version
       where version.site_id = atlas_site.id
     ) then
    select coalesce(max(version_number), 0) + 1 into next_version
    from public.artist_site_versions
    where site_id = atlas_site.id;

    insert into public.artist_site_versions (
      site_id,
      version_number,
      status,
      template_key,
      template_version,
      config,
      content_snapshot,
      created_by
    ) values (
      atlas_site.id,
      next_version,
      'draft',
      'artist-editorial',
      1,
      jsonb_build_object(
        'theme', jsonb_build_object(
          'background', '#11110f',
          'foreground', '#f5f1e8',
          'muted', '#aaa59b',
          'accent', coalesce(atlas_artist.accent_color, '#f3b61f'),
          'surface', '#1b1a17'
        ),
        'sectionOrder', jsonb_build_array('hero','releases','about','links','contact'),
        'hiddenSections', '[]'::jsonb,
        'highlightedReleaseIds', '[]'::jsonb,
        'heroEyebrow', 'Official artist site'
      ),
      jsonb_build_object(
        'schemaVersion', 1,
        'artist', jsonb_build_object(
          'id', atlas_artist.id,
          'name', atlas_artist.name,
          'slug', atlas_artist.slug,
          'bio', null,
          'avatarUrl', null,
          'accentColor', atlas_artist.accent_color
        ),
        'releases', '[]'::jsonb,
        'socialLinks', '[]'::jsonb,
        'contact', jsonb_build_object('email', null),
        'seo', jsonb_build_object(
          'title', atlas_artist.name,
          'description', atlas_artist.name || ' — official music and artist site.',
          'imageUrl', null
        )
      ),
      atlas_artist.legacy_owner_id
    )
    returning id into atlas_version_id;

    update public.artist_sites
    set draft_version_id = atlas_version_id
    where id = atlas_site.id;
  end if;

  -- Record the production hostname for migration visibility, but keep it inactive
  -- until provider verification + Atlas parity + explicit cutover approval happen.
  select domain.site_id into existing_domain_site_id
  from public.artist_site_domains domain
  where domain.hostname = 'atlasirwin.com';

  if existing_domain_site_id is not null and existing_domain_site_id <> atlas_site.id then
    raise exception 'atlasirwin.com is already mapped to another artist site';
  end if;

  if existing_domain_site_id is null then
    insert into public.artist_site_domains (
      site_id,
      hostname,
      domain_type,
      verification_status,
      ssl_status,
      is_primary
    ) values (
      atlas_site.id,
      'atlasirwin.com',
      'custom',
      'pending',
      'pending',
      false
    );
  end if;
end
$$;
