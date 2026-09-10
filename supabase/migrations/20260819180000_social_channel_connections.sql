create table public.social_channel_accounts (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  external_account_id text not null,
  display_name text,
  username text,
  profile_url text,
  image_url text,
  status text not null default 'connected' check (status in ('connected', 'needs_reauth', 'error')),
  granted_scopes text[] not null default '{}',
  can_publish boolean not null default false,
  raw_profile jsonb not null default '{}',
  connected_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, platform)
);

create table private.social_channel_tokens (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  access_token text not null,
  refresh_token text,
  scope text,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, platform)
);

alter table public.social_channel_accounts enable row level security;
alter table private.social_channel_tokens enable row level security;

create policy "admins select own social_channel_accounts"
  on public.social_channel_accounts for select to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins insert own social_channel_accounts"
  on public.social_channel_accounts for insert to authenticated
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins update own social_channel_accounts"
  on public.social_channel_accounts for update to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins delete own social_channel_accounts"
  on public.social_channel_accounts for delete to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin());

create trigger set_social_channel_accounts_updated_at
  before update on public.social_channel_accounts
  for each row execute function private.set_updated_at();
create trigger set_social_channel_tokens_updated_at
  before update on private.social_channel_tokens
  for each row execute function private.set_updated_at();

grant select, insert, update, delete on public.social_channel_accounts to authenticated;
revoke all on private.social_channel_tokens from public, anon, authenticated;

create or replace function public.get_social_channel_token(p_owner_id uuid, p_platform text)
returns table(
  access_token text,
  refresh_token text,
  scope text,
  expires_at timestamptz,
  refresh_expires_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select t.access_token, t.refresh_token, t.scope, t.expires_at, t.refresh_expires_at
  from private.social_channel_tokens t
  where t.owner_id = p_owner_id and t.platform = p_platform
$$;

create or replace function public.upsert_social_channel_token(
  p_owner_id uuid,
  p_platform text,
  p_access_token text,
  p_refresh_token text,
  p_scope text,
  p_expires_at timestamptz,
  p_refresh_expires_at timestamptz
)
returns void language sql security definer set search_path = ''
as $$
  insert into private.social_channel_tokens as current_token(
    owner_id, platform, access_token, refresh_token, scope, expires_at, refresh_expires_at
  )
  values(
    p_owner_id, p_platform, p_access_token, p_refresh_token, p_scope, p_expires_at, p_refresh_expires_at
  )
  on conflict(owner_id, platform) do update set
    access_token = excluded.access_token,
    refresh_token = coalesce(excluded.refresh_token, current_token.refresh_token),
    scope = excluded.scope,
    expires_at = excluded.expires_at,
    refresh_expires_at = coalesce(excluded.refresh_expires_at, current_token.refresh_expires_at)
$$;

create or replace function public.delete_social_channel_token(p_owner_id uuid, p_platform text)
returns void language sql security definer set search_path = ''
as $$
  delete from private.social_channel_tokens
  where owner_id = p_owner_id and platform = p_platform
$$;

revoke all on function public.get_social_channel_token(uuid, text) from public, anon, authenticated;
revoke all on function public.upsert_social_channel_token(uuid, text, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.delete_social_channel_token(uuid, text) from public, anon, authenticated;
grant execute on function public.get_social_channel_token(uuid, text) to service_role;
grant execute on function public.upsert_social_channel_token(uuid, text, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.delete_social_channel_token(uuid, text) to service_role;
