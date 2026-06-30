create table public.spotify_accounts (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  spotify_account_id text not null,
  display_name text not null,
  profile_url text,
  image_url text,
  artist_id text,
  artist_name text,
  artist_url text,
  artist_image_url text,
  raw_profile jsonb not null default '{}',
  raw_artist jsonb not null default '{}',
  top_artists jsonb not null default '[]',
  top_tracks jsonb not null default '[]',
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.spotify_tokens (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  scope text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.spotify_albums (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  spotify_id text not null,
  name text not null,
  album_type text not null,
  total_tracks integer not null default 0 check(total_tracks >= 0),
  release_date text,
  release_date_precision text,
  spotify_url text not null,
  image_url text,
  uri text not null,
  raw_album jsonb not null default '{}',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, spotify_id)
);

create table public.spotify_tracks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  spotify_id text not null,
  album_spotify_id text not null,
  name text not null,
  duration_ms integer not null default 0 check(duration_ms >= 0),
  explicit boolean not null default false,
  disc_number integer not null default 1,
  track_number integer not null default 1,
  spotify_url text not null,
  uri text not null,
  isrc text,
  raw_track jsonb not null default '{}',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, spotify_id)
);

create table public.spotify_playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  spotify_id text not null,
  name text not null,
  description text,
  spotify_url text not null,
  image_url text,
  uri text not null,
  is_public boolean,
  collaborative boolean not null default false,
  item_count integer not null default 0 check(item_count >= 0),
  owner_name text,
  raw_playlist jsonb not null default '{}',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, spotify_id)
);

create index spotify_albums_owner_release_idx on public.spotify_albums(owner_id, release_date desc);
create index spotify_tracks_owner_album_idx on public.spotify_tracks(owner_id, album_spotify_id, disc_number, track_number);
create index spotify_tracks_owner_isrc_idx on public.spotify_tracks(owner_id, isrc) where isrc is not null;
create index spotify_playlists_owner_synced_idx on public.spotify_playlists(owner_id, synced_at desc);

alter table public.spotify_accounts enable row level security;
alter table public.spotify_albums enable row level security;
alter table public.spotify_tracks enable row level security;
alter table public.spotify_playlists enable row level security;
alter table private.spotify_tokens enable row level security;

create policy "admins select own spotify_accounts" on public.spotify_accounts for select to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins insert own spotify_accounts" on public.spotify_accounts for insert to authenticated with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins update own spotify_accounts" on public.spotify_accounts for update to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin()) with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins delete own spotify_accounts" on public.spotify_accounts for delete to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin());

create policy "admins select own spotify_albums" on public.spotify_albums for select to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins insert own spotify_albums" on public.spotify_albums for insert to authenticated with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins update own spotify_albums" on public.spotify_albums for update to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin()) with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins delete own spotify_albums" on public.spotify_albums for delete to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin());

create policy "admins select own spotify_tracks" on public.spotify_tracks for select to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins insert own spotify_tracks" on public.spotify_tracks for insert to authenticated with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins update own spotify_tracks" on public.spotify_tracks for update to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin()) with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins delete own spotify_tracks" on public.spotify_tracks for delete to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin());

create policy "admins select own spotify_playlists" on public.spotify_playlists for select to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins insert own spotify_playlists" on public.spotify_playlists for insert to authenticated with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins update own spotify_playlists" on public.spotify_playlists for update to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin()) with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins delete own spotify_playlists" on public.spotify_playlists for delete to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin());

create trigger set_spotify_accounts_updated_at before update on public.spotify_accounts for each row execute function private.set_updated_at();
create trigger set_spotify_tokens_updated_at before update on private.spotify_tokens for each row execute function private.set_updated_at();
create trigger set_spotify_albums_updated_at before update on public.spotify_albums for each row execute function private.set_updated_at();
create trigger set_spotify_tracks_updated_at before update on public.spotify_tracks for each row execute function private.set_updated_at();
create trigger set_spotify_playlists_updated_at before update on public.spotify_playlists for each row execute function private.set_updated_at();

grant select,insert,update,delete on public.spotify_accounts to authenticated;
grant select,insert,update,delete on public.spotify_albums to authenticated;
grant select,insert,update,delete on public.spotify_tracks to authenticated;
grant select,insert,update,delete on public.spotify_playlists to authenticated;
revoke all on private.spotify_tokens from public, anon, authenticated;

create or replace function public.get_spotify_token(p_owner_id uuid)
returns table(access_token text, refresh_token text, scope text, expires_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select t.access_token, t.refresh_token, t.scope, t.expires_at
  from private.spotify_tokens t where t.owner_id = p_owner_id
$$;

create or replace function public.upsert_spotify_token(
  p_owner_id uuid, p_access_token text, p_refresh_token text, p_scope text, p_expires_at timestamptz
)
returns void language sql security definer set search_path = ''
as $$
  insert into private.spotify_tokens(owner_id, access_token, refresh_token, scope, expires_at)
  values(p_owner_id, p_access_token, p_refresh_token, p_scope, p_expires_at)
  on conflict(owner_id) do update set
    access_token=excluded.access_token,
    refresh_token=excluded.refresh_token,
    scope=excluded.scope,
    expires_at=excluded.expires_at
$$;

create or replace function public.delete_spotify_token(p_owner_id uuid)
returns void language sql security definer set search_path = ''
as $$ delete from private.spotify_tokens where owner_id = p_owner_id $$;

revoke all on function public.get_spotify_token(uuid) from public, anon, authenticated;
revoke all on function public.upsert_spotify_token(uuid,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.delete_spotify_token(uuid) from public, anon, authenticated;
grant execute on function public.get_spotify_token(uuid) to service_role;
grant execute on function public.upsert_spotify_token(uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.delete_spotify_token(uuid) to service_role;
