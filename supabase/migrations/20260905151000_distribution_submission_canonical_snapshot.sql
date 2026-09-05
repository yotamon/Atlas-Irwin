-- Every immutable distribution submission must carry the canonical Ensemblis identity that was
-- approved at that moment. Callers cannot accidentally omit last-mile release metadata or the
-- territory contract from the evidence snapshot.

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
  v_label text;
  v_upc text;
  v_identity jsonb;
  v_territories jsonb;
  v_metadata_snapshot jsonb;
  v_destination_snapshot jsonb;
begin
  select r.owner_id, r.artist_id, r.label, r.upc
  into v_owner, v_artist, v_label, v_upc
  from public.releases r
  where r.id = p_release_id and r.owner_id = (select auth.uid());

  if v_owner is null or v_artist is null or not private.is_studio_admin() then
    raise exception 'Release not found or unauthorized';
  end if;
  perform private.assert_operational_artist_owner(v_owner, v_artist);

  select jsonb_build_object(
    'metadataLanguageCode', m.metadata_language_code,
    'labelName', v_label,
    'catalogNumber', m.catalog_number,
    'productCopyrightLine', m.product_copyright_line,
    'recordingCopyrightLine', m.recording_copyright_line,
    'upcSource', m.upc_source,
    'upcStatus', m.upc_status,
    'upc', v_upc,
    'originalReleaseDate', m.original_release_date,
    'preorderDate', m.preorder_date
  ) into v_identity
  from public.distribution_release_metadata m
  where m.release_id = p_release_id and m.owner_id = v_owner and m.artist_id = v_artist;

  select coalesce(c.territories, '{"mode":"worldwide","countries":[]}'::jsonb)
  into v_territories
  from public.release_distribution_configs c
  where c.release_id = p_release_id and c.owner_id = v_owner and c.artist_id = v_artist;
  v_territories := coalesce(v_territories, '{"mode":"worldwide","countries":[]}'::jsonb);

  v_metadata_snapshot := coalesce(p_metadata_snapshot, '{}'::jsonb)
    || jsonb_build_object('distributionIdentity', coalesce(v_identity, '{}'::jsonb));
  v_destination_snapshot := coalesce(p_destination_snapshot, '{}'::jsonb)
    || jsonb_build_object('territories', v_territories);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_release_id::text, 0));
  select coalesce(max(version), 0) + 1
  into v_version
  from public.distribution_submissions
  where release_id = p_release_id and artist_id = v_artist;

  insert into public.distribution_submissions(
    owner_id, artist_id, release_id, version, provider, provider_release_id,
    metadata_snapshot, rights_snapshot, ai_provenance_snapshot,
    asset_snapshot, destination_snapshot, provider_snapshot
  ) values (
    v_owner, v_artist, p_release_id, v_version, p_provider, p_provider_release_id,
    v_metadata_snapshot, p_rights_snapshot, p_ai_provenance_snapshot,
    p_asset_snapshot, v_destination_snapshot, p_provider_snapshot
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_distribution_submission(uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.create_distribution_submission(uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

comment on function public.create_distribution_submission(uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) is
  'Allocates an immutable artist-scoped submission version and injects canonical release identity plus territory evidence into the stored snapshots.';
