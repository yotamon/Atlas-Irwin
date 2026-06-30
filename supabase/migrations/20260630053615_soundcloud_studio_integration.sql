create table public.soundcloud_accounts (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  soundcloud_user_id text not null,
  username text not null,
  permalink_url text,
  avatar_url text,
  raw_profile jsonb not null default '{}',
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.soundcloud_tokens (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  scope text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.soundcloud_tracks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  soundcloud_id bigint not null,
  title text not null,
  description text,
  genre text,
  permalink_url text not null,
  artwork_url text,
  duration integer check(duration is null or duration >= 0),
  playback_count bigint not null default 0 check(playback_count >= 0),
  favoritings_count bigint not null default 0 check(favoritings_count >= 0),
  comment_count bigint not null default 0 check(comment_count >= 0),
  reposts_count bigint not null default 0 check(reposts_count >= 0),
  streamable boolean not null default false,
  downloadable boolean not null default false,
  sharing text,
  raw_track jsonb not null default '{}',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, soundcloud_id)
);

create table public.soundcloud_playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  soundcloud_id bigint not null,
  title text not null,
  description text,
  genre text,
  permalink_url text not null,
  artwork_url text,
  duration integer check(duration is null or duration >= 0),
  track_count integer not null default 0 check(track_count >= 0),
  raw_playlist jsonb not null default '{}',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, soundcloud_id)
);

create index soundcloud_tracks_owner_synced_idx on public.soundcloud_tracks(owner_id, synced_at desc);
create index soundcloud_tracks_permalink_idx on public.soundcloud_tracks(owner_id, permalink_url);
create index soundcloud_playlists_owner_synced_idx on public.soundcloud_playlists(owner_id, synced_at desc);

alter table public.soundcloud_accounts enable row level security;
alter table public.soundcloud_tracks enable row level security;
alter table public.soundcloud_playlists enable row level security;
alter table private.soundcloud_tokens enable row level security;

create policy "admins select own soundcloud_accounts" on public.soundcloud_accounts for select to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins insert own soundcloud_accounts" on public.soundcloud_accounts for insert to authenticated with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins update own soundcloud_accounts" on public.soundcloud_accounts for update to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin()) with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins delete own soundcloud_accounts" on public.soundcloud_accounts for delete to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin());

create policy "admins select own soundcloud_tracks" on public.soundcloud_tracks for select to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins insert own soundcloud_tracks" on public.soundcloud_tracks for insert to authenticated with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins update own soundcloud_tracks" on public.soundcloud_tracks for update to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin()) with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins delete own soundcloud_tracks" on public.soundcloud_tracks for delete to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin());

create policy "admins select own soundcloud_playlists" on public.soundcloud_playlists for select to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins insert own soundcloud_playlists" on public.soundcloud_playlists for insert to authenticated with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins update own soundcloud_playlists" on public.soundcloud_playlists for update to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin()) with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins delete own soundcloud_playlists" on public.soundcloud_playlists for delete to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin());

create trigger set_soundcloud_accounts_updated_at before update on public.soundcloud_accounts for each row execute function private.set_updated_at();
create trigger set_soundcloud_tokens_updated_at before update on private.soundcloud_tokens for each row execute function private.set_updated_at();
create trigger set_soundcloud_tracks_updated_at before update on public.soundcloud_tracks for each row execute function private.set_updated_at();
create trigger set_soundcloud_playlists_updated_at before update on public.soundcloud_playlists for each row execute function private.set_updated_at();

grant select,insert,update,delete on public.soundcloud_accounts to authenticated;
grant select,insert,update,delete on public.soundcloud_tracks to authenticated;
grant select,insert,update,delete on public.soundcloud_playlists to authenticated;
revoke all on private.soundcloud_tokens from public, anon, authenticated;

create function public.get_soundcloud_token(p_owner_id uuid)
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

create function public.upsert_soundcloud_token(
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

create function public.delete_soundcloud_token(p_owner_id uuid)
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
