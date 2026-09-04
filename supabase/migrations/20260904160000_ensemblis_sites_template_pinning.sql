-- Published Sites must pin both template identity and template version.
-- A later code/template upgrade must create a new draft instead of mutating
-- already-published output underneath an immutable content snapshot.

alter table public.artist_site_versions
  add column template_key text,
  add column template_version integer;

update public.artist_site_versions version
set template_key = site.template_key,
    template_version = 1
from public.artist_sites site
where site.id = version.site_id;

alter table public.artist_site_versions
  alter column template_key set not null,
  alter column template_version set not null,
  add constraint artist_site_versions_template_key_nonempty
    check (length(trim(template_key)) > 0),
  add constraint artist_site_versions_template_version_positive
    check (template_version > 0);

create index artist_site_versions_template_idx
  on public.artist_site_versions(template_key, template_version);

-- Extend the immutable published-version guard to template lineage.
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
    or new.template_key is distinct from old.template_key
    or new.template_version is distinct from old.template_version
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

-- Recreate draft/rollback helpers so cloned versions retain the exact template
-- lineage of their source. A template upgrade is therefore an explicit new draft.
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
    source_row.content_snapshot,
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
    source_row.content_snapshot,
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
