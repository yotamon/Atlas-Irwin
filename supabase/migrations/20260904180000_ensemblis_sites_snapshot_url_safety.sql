-- Keep public Sites snapshots renderable even when canonical catalog rows contain
-- blank or stale link fields. Published versions remain immutable: existing bad
-- snapshots are repaired only when cloned into a new draft or rollback version.

create or replace function private.sanitize_artist_site_snapshot(input_snapshot jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  result jsonb := coalesce(input_snapshot, '{}'::jsonb);
  release_row jsonb;
  track_row jsonb;
  link_row jsonb;
  social_row jsonb;
  sanitized_releases jsonb := '[]'::jsonb;
  sanitized_tracks jsonb;
  sanitized_links jsonb;
  sanitized_social jsonb := '[]'::jsonb;
  candidate text;
begin
  if jsonb_typeof(result) <> 'object' then
    return input_snapshot;
  end if;

  if jsonb_typeof(result->'releases') = 'array' then
    for release_row in select value from jsonb_array_elements(result->'releases') loop
      sanitized_links := '[]'::jsonb;
      if jsonb_typeof(release_row->'links') = 'array' then
        for link_row in select value from jsonb_array_elements(release_row->'links') loop
          candidate := nullif(btrim(link_row->>'href'), '');
          if candidate is not null
             and candidate ~* '^https?://[^[:space:]]+$'
             and nullif(btrim(link_row->>'label'), '') is not null
             and nullif(btrim(link_row->>'provider'), '') is not null then
            sanitized_links := sanitized_links || jsonb_build_array(
              jsonb_set(link_row, '{href}', to_jsonb(candidate), true)
            );
          end if;
        end loop;
      end if;
      release_row := jsonb_set(release_row, '{links}', sanitized_links, true);

      sanitized_tracks := '[]'::jsonb;
      if jsonb_typeof(release_row->'tracks') = 'array' then
        for track_row in select value from jsonb_array_elements(release_row->'tracks') loop
          candidate := nullif(btrim(track_row->>'audioUrl'), '');
          track_row := jsonb_set(
            track_row,
            '{audioUrl}',
            case
              when candidate is not null and (candidate like '/%' or candidate ~* '^https?://[^[:space:]]+$')
                then to_jsonb(candidate)
              else 'null'::jsonb
            end,
            true
          );

          candidate := nullif(btrim(track_row->>'soundcloudUrl'), '');
          track_row := jsonb_set(
            track_row,
            '{soundcloudUrl}',
            case
              when candidate is not null and candidate ~* '^https?://[^[:space:]]+$'
                then to_jsonb(candidate)
              else 'null'::jsonb
            end,
            true
          );

          candidate := nullif(btrim(track_row->>'spotifyUrl'), '');
          track_row := jsonb_set(
            track_row,
            '{spotifyUrl}',
            case
              when candidate is not null and candidate ~* '^https?://[^[:space:]]+$'
                then to_jsonb(candidate)
              else 'null'::jsonb
            end,
            true
          );

          sanitized_tracks := sanitized_tracks || jsonb_build_array(track_row);
        end loop;
      end if;
      release_row := jsonb_set(release_row, '{tracks}', sanitized_tracks, true);
      sanitized_releases := sanitized_releases || jsonb_build_array(release_row);
    end loop;
    result := jsonb_set(result, '{releases}', sanitized_releases, true);
  end if;

  if jsonb_typeof(result->'socialLinks') = 'array' then
    for social_row in select value from jsonb_array_elements(result->'socialLinks') loop
      candidate := nullif(btrim(social_row->>'href'), '');
      if candidate is not null
         and candidate ~* '^https?://[^[:space:]]+$'
         and nullif(btrim(social_row->>'label'), '') is not null
         and nullif(btrim(social_row->>'provider'), '') is not null then
        sanitized_social := sanitized_social || jsonb_build_array(
          jsonb_set(social_row, '{href}', to_jsonb(candidate), true)
        );
      end if;
    end loop;
    result := jsonb_set(result, '{socialLinks}', sanitized_social, true);
  end if;

  candidate := nullif(btrim(result#>>'{seo,imageUrl}'), '');
  if result ? 'seo' and jsonb_typeof(result->'seo') = 'object' then
    result := jsonb_set(
      result,
      '{seo,imageUrl}',
      case
        when candidate is not null and candidate ~* '^https?://[^[:space:]]+$'
          then to_jsonb(candidate)
        else 'null'::jsonb
      end,
      true
    );
  end if;

  return result;
end
$$;

-- Draft snapshots are mutable and can be normalized in place.
update public.artist_site_versions
set content_snapshot = private.sanitize_artist_site_snapshot(content_snapshot)
where status = 'draft'
  and content_snapshot is distinct from private.sanitize_artist_site_snapshot(content_snapshot);

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
    site_id,
    version_number,
    status,
    template_key,
    template_version,
    config,
    content_snapshot,
    created_by
  ) values (
    site_row.id,
    next_version,
    'draft',
    source_row.template_key,
    source_row.template_version,
    source_row.config,
    private.sanitize_artist_site_snapshot(source_row.content_snapshot),
    (select auth.uid())
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
    site_id,
    version_number,
    status,
    template_key,
    template_version,
    config,
    content_snapshot,
    created_by,
    published_at
  ) values (
    site_row.id,
    next_version,
    'published',
    source_row.template_key,
    source_row.template_version,
    source_row.config,
    private.sanitize_artist_site_snapshot(source_row.content_snapshot),
    (select auth.uid()),
    now()
  ) returning id into rollback_version_id;

  update public.artist_sites
  set state = 'published',
      published_version_id = rollback_version_id,
      draft_version_id = null,
      template_key = source_row.template_key
  where id = site_row.id;

  insert into public.artist_site_deployments (
    site_id, version_id, provider, provider_ref, status, completed_at
  ) values (
    site_row.id, rollback_version_id, 'shared-runtime', source_version_id::text, 'ready', now()
  );

  return rollback_version_id;
end
$$;

revoke all on function private.sanitize_artist_site_snapshot(jsonb) from public, anon;
revoke all on function public.create_artist_site_draft(uuid) from public, anon;
revoke all on function public.rollback_artist_site(uuid, uuid) from public, anon;
grant execute on function public.create_artist_site_draft(uuid) to authenticated;
grant execute on function public.rollback_artist_site(uuid, uuid) to authenticated;
