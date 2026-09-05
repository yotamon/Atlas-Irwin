-- Atomic artist-facing distribution identity save.
-- `releases.label` and `releases.upc` stay canonical; last-mile metadata is committed with them.

create or replace function public.save_distribution_release_identity(
  p_release_id uuid,
  p_label text,
  p_upc_source text,
  p_upc text,
  p_metadata_language_code text,
  p_catalog_number text,
  p_product_copyright_line text,
  p_recording_copyright_line text,
  p_original_release_date date,
  p_preorder_date date
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_artist uuid;
  v_existing_upc text;
  v_existing_source text;
  v_state text;
  v_upc text;
  v_upc_status text;
begin
  select r.owner_id, r.artist_id, r.upc
  into v_owner, v_artist, v_existing_upc
  from public.releases r
  where r.id = p_release_id and r.owner_id = (select auth.uid());

  if v_owner is null or v_artist is null or not private.can_access_artist(v_artist) then
    raise exception 'Release not found for the active artist';
  end if;
  perform private.assert_operational_artist_owner(v_owner, v_artist);

  select c.state into v_state
  from public.release_distribution_configs c
  where c.release_id = p_release_id and c.owner_id = v_owner and c.artist_id = v_artist;
  if v_state is not null and v_state not in ('draft','needs_attention','ready','rejected','error') then
    raise exception 'Distribution identity is locked after submission. Start a correction workflow first.';
  end if;

  if p_upc_source not in ('provider','artist') then raise exception 'Unsupported UPC source'; end if;
  if p_metadata_language_code is null or char_length(btrim(p_metadata_language_code)) not between 2 and 16 then
    raise exception 'Metadata language is required';
  end if;
  if p_preorder_date is not null and p_original_release_date is not null and p_preorder_date > p_original_release_date then
    raise exception 'Pre-order date cannot be after original release date';
  end if;

  select m.upc_source into v_existing_source
  from public.distribution_release_metadata m
  where m.release_id = p_release_id;

  if p_upc_source = 'artist' then
    v_upc := regexp_replace(coalesce(p_upc, ''), '[^0-9]', '', 'g');
    if v_upc !~ '^[0-9]{12,14}$' then raise exception 'A supplied UPC/EAN must contain 12 to 14 digits'; end if;
    v_upc_status := 'assigned';
  else
    -- Preserve a provider-origin code once assigned; switching from an artist-owned code asks the
    -- provider for a fresh code instead of silently reclassifying the artist's identifier.
    v_upc := case when v_existing_source = 'provider' then v_existing_upc else null end;
    v_upc_status := case when v_upc is null then 'unassigned' else 'assigned' end;
  end if;

  update public.releases
  set label = nullif(btrim(coalesce(p_label, '')), ''),
      upc = v_upc,
      updated_at = now()
  where id = p_release_id and owner_id = v_owner and artist_id = v_artist;

  insert into public.distribution_release_metadata(
    release_id, owner_id, artist_id, metadata_language_code, catalog_number,
    product_copyright_line, recording_copyright_line, upc_source, upc_status,
    original_release_date, preorder_date
  ) values (
    p_release_id, v_owner, v_artist, btrim(p_metadata_language_code), nullif(btrim(coalesce(p_catalog_number,'')),''),
    btrim(coalesce(p_product_copyright_line,'')), btrim(coalesce(p_recording_copyright_line,'')), p_upc_source, v_upc_status,
    p_original_release_date, p_preorder_date
  )
  on conflict (release_id) do update set
    metadata_language_code = excluded.metadata_language_code,
    catalog_number = excluded.catalog_number,
    product_copyright_line = excluded.product_copyright_line,
    recording_copyright_line = excluded.recording_copyright_line,
    upc_source = excluded.upc_source,
    upc_status = excluded.upc_status,
    original_release_date = excluded.original_release_date,
    preorder_date = excluded.preorder_date;
end;
$$;

revoke all on function public.save_distribution_release_identity(uuid,text,text,text,text,text,text,text,date,date) from public, anon;
grant execute on function public.save_distribution_release_identity(uuid,text,text,text,text,text,text,text,date,date) to authenticated;

comment on function public.save_distribution_release_identity(uuid,text,text,text,text,text,text,text,date,date) is
  'Atomically updates canonical release label/UPC and provider-neutral last-mile identity. Post-submission edits remain blocked until a correction workflow is opened.';
