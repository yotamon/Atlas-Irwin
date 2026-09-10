-- Ensemblis Distribution: make release/catalog operations artist-scoped on top of #76.
--
-- distribution_accounts intentionally remains account/workspace-level: one provider account may
-- serve multiple artists. Every artist identity, release delivery object and track-credit object
-- carries durable artist_id. owner_id remains authentication/compatibility metadata.

alter table public.distribution_artist_profiles add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.release_distribution_configs add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.distribution_submissions add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.distribution_deliveries add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.distribution_validation_issues add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.distribution_events add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.distribution_track_metadata add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.distribution_track_writers add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.distribution_track_contributors add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.distribution_provider_operations add column if not exists artist_id uuid references public.artists(id) on delete restrict;

-- Backfill only from canonical parent lineage. The DSP artist-profile table predates a canonical
-- artist FK, so existing legacy rows may use the deterministic legacy artist mapping only during
-- this migration window. No arbitrary owner -> artist fallback is introduced for future writes.
update public.distribution_artist_profiles p
set artist_id = coalesce(
  (
    select a.id
    from public.artists a
    where a.legacy_owner_id = p.owner_id
      and lower(a.name) = lower(p.artist_name)
      and a.status = 'active'
    order by a.created_at
    limit 1
  ),
  private.legacy_artist_for_owner(p.owner_id)
)
where p.artist_id is null;

update public.release_distribution_configs x
set artist_id = r.artist_id
from public.releases r
where r.id = x.release_id and x.artist_id is null;

-- Submission snapshots are immutable at runtime; temporarily disable only the mutation guard for
-- this one schema backfill, then restore it before the migration completes.
alter table public.distribution_submissions disable trigger prevent_distribution_submission_update;
update public.distribution_submissions x
set artist_id = r.artist_id
from public.releases r
where r.id = x.release_id and x.artist_id is null;
alter table public.distribution_submissions enable trigger prevent_distribution_submission_update;

update public.distribution_deliveries x
set artist_id = r.artist_id
from public.releases r
where r.id = x.release_id and x.artist_id is null;

update public.distribution_validation_issues x
set artist_id = r.artist_id
from public.releases r
where r.id = x.release_id and x.artist_id is null;

update public.distribution_provider_operations x
set artist_id = r.artist_id
from public.releases r
where r.id = x.release_id and x.artist_id is null;

update public.distribution_events x
set artist_id = coalesce(
  (select r.artist_id from public.releases r where r.id = x.release_id),
  (select s.artist_id from public.distribution_submissions s where s.id = x.submission_id),
  private.legacy_artist_for_owner(x.owner_id)
)
where x.artist_id is null;

update public.distribution_track_metadata x
set artist_id = r.artist_id
from public.tracks t
join public.releases r on r.id = t.release_id
where t.id = x.track_id and x.artist_id is null;

update public.distribution_track_writers x
set artist_id = r.artist_id
from public.tracks t
join public.releases r on r.id = t.release_id
where t.id = x.track_id and x.artist_id is null;

update public.distribution_track_contributors x
set artist_id = r.artist_id
from public.tracks t
join public.releases r on r.id = t.release_id
where t.id = x.track_id and x.artist_id is null;

-- Fail closed rather than leaving sibling-artist-visible operational history.
do $$
declare
  t text;
  missing_count bigint;
begin
  foreach t in array array[
    'distribution_artist_profiles','release_distribution_configs','distribution_submissions',
    'distribution_deliveries','distribution_validation_issues','distribution_events',
    'distribution_track_metadata','distribution_track_writers','distribution_track_contributors',
    'distribution_provider_operations'
  ] loop
    execute format('select count(*) from public.%I where artist_id is null', t) into missing_count;
    if missing_count > 0 then
      raise exception 'Ensemblis Distribution artist backfill failed for % (% rows)', t, missing_count;
    end if;
  end loop;
end $$;

-- Service-role-safe lineage guard. RLS is not trusted as a worker boundary.
create or replace function private.validate_distribution_artist_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected uuid;
  linked uuid;
begin
  expected := new.artist_id;

  if tg_table_name in (
    'release_distribution_configs','distribution_submissions','distribution_deliveries',
    'distribution_validation_issues','distribution_provider_operations'
  ) then
    select artist_id into linked from public.releases where id = new.release_id;
    expected := coalesce(expected, linked);
    if linked is null or expected <> linked then
      raise exception '% artist must match release artist', tg_table_name;
    end if;
  elsif tg_table_name in ('distribution_track_metadata','distribution_track_writers','distribution_track_contributors') then
    select r.artist_id into linked
    from public.tracks t
    join public.releases r on r.id = t.release_id
    where t.id = new.track_id;
    expected := coalesce(expected, linked);
    if linked is null or expected <> linked then
      raise exception '% artist must match track release artist', tg_table_name;
    end if;
  elsif tg_table_name = 'distribution_events' then
    if new.release_id is not null then
      select artist_id into linked from public.releases where id = new.release_id;
      expected := coalesce(expected, linked);
      if linked is null or expected <> linked then raise exception 'Distribution event artist must match release artist'; end if;
    end if;
    if new.submission_id is not null then
      select artist_id into linked from public.distribution_submissions where id = new.submission_id;
      expected := coalesce(expected, linked);
      if linked is null or expected <> linked then raise exception 'Distribution event artist must match submission artist'; end if;
    end if;
  elsif tg_table_name = 'distribution_artist_profiles' then
    -- The artist profile is itself the canonical parent. Membership validation below is enough.
    null;
  end if;

  if tg_table_name = 'distribution_deliveries' and new.submission_id is not null then
    select artist_id into linked from public.distribution_submissions where id = new.submission_id;
    if linked is null or expected <> linked then raise exception 'Distribution delivery submission must belong to delivery artist'; end if;
  end if;

  if tg_table_name = 'distribution_validation_issues' and new.submission_id is not null then
    select artist_id into linked from public.distribution_submissions where id = new.submission_id;
    if linked is null or expected <> linked then raise exception 'Distribution issue submission must belong to issue artist'; end if;
  end if;

  -- Atlas compatibility may resolve only through the deterministic legacy mapping. Multi-artist
  -- accounts without that mapping must always supply/derive artist_id explicitly.
  if expected is null then expected := private.legacy_artist_for_owner(new.owner_id); end if;
  perform private.assert_operational_artist_owner(new.owner_id, expected);
  new.artist_id := expected;
  return new;
end;
$$;
revoke all on function private.validate_distribution_artist_scope() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'distribution_artist_profiles','release_distribution_configs','distribution_submissions',
    'distribution_deliveries','distribution_validation_issues','distribution_events',
    'distribution_track_metadata','distribution_track_writers','distribution_track_contributors',
    'distribution_provider_operations'
  ] loop
    execute format('drop trigger if exists %1$I_validate_artist_scope on public.%1$I', t);
    execute format('create trigger %1$I_validate_artist_scope before insert or update on public.%1$I for each row execute function private.validate_distribution_artist_scope()', t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array[
    'distribution_artist_profiles','release_distribution_configs','distribution_submissions',
    'distribution_deliveries','distribution_validation_issues','distribution_events',
    'distribution_track_metadata','distribution_track_writers','distribution_track_contributors',
    'distribution_provider_operations'
  ] loop
    execute format('alter table public.%I alter column artist_id set not null', t);
  end loop;
end $$;

-- Artist-local identities and lookup paths. The provider account itself intentionally stays shared.
alter table public.distribution_artist_profiles drop constraint if exists distribution_artist_profiles_owner_id_artist_name_platform_key;
create unique index if not exists distribution_artist_profiles_artist_platform_idx
  on public.distribution_artist_profiles(artist_id, platform);

create index if not exists release_distribution_artist_state_idx
  on public.release_distribution_configs(artist_id, state);
create index if not exists distribution_submissions_artist_release_idx
  on public.distribution_submissions(artist_id, release_id, version desc);
create index if not exists distribution_deliveries_artist_state_idx
  on public.distribution_deliveries(artist_id, state, updated_at desc);
create index if not exists distribution_issues_artist_open_idx
  on public.distribution_validation_issues(artist_id, status, severity)
  where status in ('open','acknowledged');
create index if not exists distribution_events_artist_idx
  on public.distribution_events(artist_id, created_at desc);
create index if not exists distribution_provider_operations_artist_idx
  on public.distribution_provider_operations(artist_id, state, created_at desc);
create index if not exists distribution_track_metadata_artist_idx
  on public.distribution_track_metadata(artist_id);
create index if not exists distribution_track_writers_artist_idx
  on public.distribution_track_writers(artist_id, track_id);
create index if not exists distribution_track_contributors_artist_idx
  on public.distribution_track_contributors(artist_id, track_id);

-- Submission creation derives artist scope from the canonical release and records it atomically.
create or replace function public.create_distribution_submission(
  p_release_id uuid,
  p_provider text,
  p_provider_release_id text,
  p_metadata_snapshot jsonb,
  p_rights_snapshot jsonb,
  p_ai_provenance_snapshot jsonb,
  p_asset_snapshot jsonb,
  p_destination_snapshot jsonb,
  p_provider_snapshot jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_artist uuid;
  v_version integer;
  v_id uuid;
begin
  select owner_id, artist_id into v_owner, v_artist
  from public.releases
  where id = p_release_id and owner_id = (select auth.uid());

  if v_owner is null or v_artist is null or not private.is_studio_admin() then
    raise exception 'Release not found or unauthorized';
  end if;
  perform private.assert_operational_artist_owner(v_owner, v_artist);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_release_id::text, 0));
  select coalesce(max(version), 0) + 1
  into v_version
  from public.distribution_submissions
  where release_id = p_release_id and artist_id = v_artist;

  insert into public.distribution_submissions(
    owner_id, artist_id, release_id, version, provider, provider_release_id,
    metadata_snapshot, rights_snapshot, ai_provenance_snapshot,
    asset_snapshot, destination_snapshot, provider_snapshot
  )
  values(
    v_owner, v_artist, p_release_id, v_version, p_provider, p_provider_release_id,
    p_metadata_snapshot, p_rights_snapshot, p_ai_provenance_snapshot,
    p_asset_snapshot, p_destination_snapshot, p_provider_snapshot
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on column public.distribution_artist_profiles.artist_id is 'Canonical Ensemblis artist identity; owner_id is authentication/compatibility metadata.';
comment on column public.release_distribution_configs.artist_id is 'Canonical Ensemblis artist inherited from release_id.';
comment on column public.distribution_submissions.artist_id is 'Immutable submission artist inherited from release_id.';
