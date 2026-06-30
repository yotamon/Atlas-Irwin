create extension if not exists pgcrypto;
create schema if not exists private;

create type public.release_type as enum ('Single','EP','Album','Album Track','Edit','Instrumental','DJ Tool');
create type public.release_status as enum ('Idea','In Progress','Scheduled','Live','Archived');
create type public.content_platform as enum ('Instagram','TikTok','YouTube Shorts','SoundCloud','Spotify','Newsletter','Other');
create type public.content_status as enum ('Idea','Draft','In Production','Ready','Scheduled','Published','Archived');
create type public.contact_type as enum ('DJ','Playlist','Curator','Music page','Creator','Club','Community','Press','Other');
create type public.relationship_status as enum ('Researching','Ready to Contact','Contacted','Replied','Interested','Follow-up Needed','Not Relevant','Archived');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.releases (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, slug text not null, release_type public.release_type not null default 'Single', status public.release_status not null default 'Idea', release_date date,
  story text, core_emotion text, audience text, primary_hook text, visual_direction text, color_palette text[] not null default '{}', notes text,
  spotify_url text, soundcloud_url text, youtube_url text, smart_link_url text, artwork_url text, cover_asset text,
  public_slug text, public_release_path text, story_answers jsonb not null default '{}', release_identity jsonb not null default '{}', readiness jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id,slug)
);
create table public.tracks (
  id uuid primary key default gen_random_uuid(), release_id uuid not null references public.releases(id) on delete cascade, owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, version text, duration integer check(duration is null or duration >= 0), audio_url text, soundcloud_url text, spotify_url text, is_primary boolean not null default false, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.tracks add constraint tracks_release_title_unique unique(release_id,title);
create table public.content_items (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade, release_id uuid references public.releases(id) on delete set null,
  title text not null, platform public.content_platform not null default 'Instagram', format text not null, status public.content_status not null default 'Idea', goal text not null default 'Reach',
  scheduled_at timestamptz, published_at timestamptz, audio_timestamp_start integer check(audio_timestamp_start is null or audio_timestamp_start >= 0), audio_timestamp_end integer check(audio_timestamp_end is null or audio_timestamp_end >= 0),
  hook_text text, caption text, cta text, visual_prompt text, production_notes text, asset_url text, performance_notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.content_assets (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade, content_item_id uuid references public.content_items(id) on delete cascade, release_id uuid references public.releases(id) on delete cascade,
  storage_path text not null unique, mime_type text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.outreach_contacts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade, name text not null, platform text, handle_or_url text, email text, city text, country text,
  contact_type public.contact_type not null default 'Other', genres text[] not null default '{}', audience_size bigint check(audience_size is null or audience_size >= 0), contact_method text,
  relationship_status public.relationship_status not null default 'Researching', notes text, tags text[] not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.outreach_messages (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade, contact_id uuid not null references public.outreach_contacts(id) on delete cascade, release_id uuid references public.releases(id) on delete set null,
  channel text not null, message text not null, sent_at timestamptz, follow_up_at timestamptz, response_status text, response_notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.metric_snapshots (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade, date date not null, platform public.content_platform not null, release_id uuid references public.releases(id) on delete set null, content_item_id uuid references public.content_items(id) on delete set null,
  reach bigint not null default 0 check(reach>=0), views bigint not null default 0 check(views>=0), watch_time bigint not null default 0 check(watch_time>=0), likes bigint not null default 0 check(likes>=0), comments bigint not null default 0 check(comments>=0), shares bigint not null default 0 check(shares>=0), saves bigint not null default 0 check(saves>=0), profile_visits bigint not null default 0 check(profile_visits>=0), follows bigint not null default 0 check(follows>=0), link_clicks bigint not null default 0 check(link_clicks>=0), streams bigint not null default 0 check(streams>=0), listeners bigint not null default 0 check(listeners>=0), playlist_adds bigint not null default 0 check(playlist_adds>=0), notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.release_learnings (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade, release_id uuid not null references public.releases(id) on delete cascade, learning text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.brand_settings (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade, section text not null, content jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id,section)
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id) on delete cascade, release_id uuid references public.releases(id) on delete cascade,
  title text not null, status text not null default 'Open', priority text not null default 'Medium', due_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index releases_status_date_idx on public.releases(owner_id,status,release_date);
create index tracks_release_idx on public.tracks(release_id);
create index content_schedule_idx on public.content_items(owner_id,scheduled_at) where scheduled_at is not null;
create index content_release_status_idx on public.content_items(release_id,status);
create index outreach_contact_status_idx on public.outreach_contacts(owner_id,relationship_status);
create index outreach_follow_up_idx on public.outreach_messages(owner_id,follow_up_at) where follow_up_at is not null;
create index metrics_release_date_idx on public.metric_snapshots(release_id,date desc);
create index tasks_due_idx on public.tasks(owner_id,due_at) where status <> 'Done';

create function private.is_studio_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true)
$$;
revoke all on function private.is_studio_admin() from public, anon;
grant execute on function private.is_studio_admin() to authenticated;

create function private.set_updated_at() returns trigger language plpgsql security invoker set search_path = '' as $$ begin new.updated_at = now(); return new; end $$;
create function private.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.profiles(id,email) values(new.id,coalesce(new.email,'')) on conflict(id) do update set email=excluded.email; return new; end $$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert or update of email on auth.users for each row execute function private.handle_new_user();
insert into public.profiles(id,email)
select id,coalesce(email,'') from auth.users
on conflict(id) do update set email=excluded.email;

do $$ declare t text; begin foreach t in array array['profiles','releases','tracks','content_items','content_assets','outreach_contacts','outreach_messages','metric_snapshots','release_learnings','brand_settings','tasks'] loop
  execute format('alter table public.%I enable row level security',t);
  if t='profiles' then
    execute 'create policy "admins read own profile" on public.profiles for select to authenticated using (id=(select auth.uid()) and private.is_studio_admin())';
  else
    execute format('create policy "admins select own %1$s" on public.%1$I for select to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin())',t);
    execute format('create policy "admins insert own %1$s" on public.%1$I for insert to authenticated with check (owner_id=(select auth.uid()) and private.is_studio_admin())',t);
    execute format('create policy "admins update own %1$s" on public.%1$I for update to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin()) with check (owner_id=(select auth.uid()) and private.is_studio_admin())',t);
    execute format('create policy "admins delete own %1$s" on public.%1$I for delete to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin())',t);
  end if;
end loop; end $$;

do $$ declare t text; begin foreach t in array array['profiles','releases','tracks','content_items','content_assets','outreach_contacts','outreach_messages','metric_snapshots','release_learnings','brand_settings','tasks'] loop
  execute format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function private.set_updated_at()',t);
end loop; end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('studio-assets','studio-assets',false,104857600,array['image/jpeg','image/png','image/webp','image/avif','video/mp4','audio/mpeg','audio/wav','audio/x-wav','application/pdf']) on conflict(id) do nothing;
create policy "admins read studio assets" on storage.objects for select to authenticated using(bucket_id='studio-assets' and private.is_studio_admin() and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "admins upload studio assets" on storage.objects for insert to authenticated with check(bucket_id='studio-assets' and private.is_studio_admin() and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "admins update studio assets" on storage.objects for update to authenticated using(bucket_id='studio-assets' and private.is_studio_admin() and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='studio-assets' and private.is_studio_admin() and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "admins delete studio assets" on storage.objects for delete to authenticated using(bucket_id='studio-assets' and private.is_studio_admin() and (storage.foldername(name))[1]=(select auth.uid())::text);

grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
