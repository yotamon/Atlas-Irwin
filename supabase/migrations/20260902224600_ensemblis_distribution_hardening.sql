-- Distribution hardening: submissions cannot be edited through authenticated APIs,
-- but release deletion must still be able to cascade through historical snapshots.
drop trigger if exists prevent_distribution_submission_delete on public.distribution_submissions;

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
  v_version integer;
  v_id uuid;
begin
  select owner_id into v_owner
  from public.releases
  where id = p_release_id and owner_id = (select auth.uid());

  if v_owner is null or not private.is_studio_admin() then
    raise exception 'Release not found or unauthorized';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_release_id::text, 0));
  select coalesce(max(version), 0) + 1
  into v_version
  from public.distribution_submissions
  where release_id = p_release_id;

  insert into public.distribution_submissions(
    owner_id, release_id, version, provider, provider_release_id,
    metadata_snapshot, rights_snapshot, ai_provenance_snapshot,
    asset_snapshot, destination_snapshot, provider_snapshot
  )
  values(
    v_owner, p_release_id, v_version, p_provider, p_provider_release_id,
    p_metadata_snapshot, p_rights_snapshot, p_ai_provenance_snapshot,
    p_asset_snapshot, p_destination_snapshot, p_provider_snapshot
  )
  returning id into v_id;

  return v_id;
end;
$$;
