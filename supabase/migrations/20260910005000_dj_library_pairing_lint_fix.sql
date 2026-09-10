-- Phase 8 follow-up: keep the deployed pairing RPC contract stable while making
-- PL/pgSQL's column/OUT-parameter resolution explicit for ON CONFLICT.
create or replace function public.claim_dj_library_pairing(
  p_code_hash text,
  p_public_id uuid,
  p_name text,
  p_platform text,
  p_app_version text,
  p_credential_hash text,
  p_credential_prefix text,
  p_capabilities jsonb
) returns table(device_id uuid, owner_id uuid, artist_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_owner_id uuid;
  v_artist_id uuid;
  v_device_id uuid;
begin
  select c.owner_id, c.artist_id
    into v_owner_id, v_artist_id
  from public.dj_library_pairing_codes c
  where c.code_hash = p_code_hash
    and c.used_at is null
    and c.expires_at > now()
  for update;

  if not found then
    raise exception 'invalid_or_expired_pairing_code' using errcode = 'P0001';
  end if;

  update public.dj_library_pairing_codes
     set used_at = now()
   where code_hash = p_code_hash;

  insert into public.dj_library_devices as d (
    owner_id, artist_id, public_id, name, platform, app_version,
    credential_hash, credential_prefix, capabilities, paired_at, last_seen_at, revoked_at
  ) values (
    v_owner_id, v_artist_id, p_public_id, left(trim(p_name), 120), p_platform,
    left(coalesce(nullif(trim(p_app_version), ''), 'unknown'), 80),
    p_credential_hash, left(p_credential_prefix, 16), coalesce(p_capabilities, '{}'::jsonb),
    now(), now(), null
  )
  on conflict (owner_id, artist_id, public_id) do update set
    name = excluded.name,
    platform = excluded.platform,
    app_version = excluded.app_version,
    credential_hash = excluded.credential_hash,
    credential_prefix = excluded.credential_prefix,
    capabilities = excluded.capabilities,
    paired_at = now(),
    last_seen_at = now(),
    revoked_at = null
  returning d.id into v_device_id;

  return query select v_device_id, v_owner_id, v_artist_id;
end;
$$;
