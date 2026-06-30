create or replace function public.get_soundcloud_token(p_owner_id uuid)
returns table(access_token text, refresh_token text, scope text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.access_token, t.refresh_token, t.scope, t.expires_at
  from private.soundcloud_tokens t
  where t.owner_id = p_owner_id
$$;

create or replace function public.upsert_soundcloud_token(
  p_owner_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_scope text,
  p_expires_at timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.soundcloud_tokens(owner_id, access_token, refresh_token, scope, expires_at)
  values(p_owner_id, p_access_token, p_refresh_token, p_scope, p_expires_at)
  on conflict(owner_id) do update set
    access_token = excluded.access_token,
    refresh_token = excluded.refresh_token,
    scope = excluded.scope,
    expires_at = excluded.expires_at
$$;

create or replace function public.delete_soundcloud_token(p_owner_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.soundcloud_tokens where owner_id = p_owner_id
$$;

revoke all on function public.get_soundcloud_token(uuid) from public, anon, authenticated;
revoke all on function public.upsert_soundcloud_token(uuid,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.delete_soundcloud_token(uuid) from public, anon, authenticated;
grant execute on function public.get_soundcloud_token(uuid) to service_role;
grant execute on function public.upsert_soundcloud_token(uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.delete_soundcloud_token(uuid) to service_role;
