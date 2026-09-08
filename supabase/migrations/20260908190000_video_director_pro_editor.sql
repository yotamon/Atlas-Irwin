-- Ensemblis Video Director Pro Editor
-- First-class timeline editing, reusable cast identity, performance intent, captions and music-reactive direction.

create table public.music_video_characters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete restrict,
  project_id uuid not null references public.music_video_projects(id) on delete cascade,
  name text not null,
  role text not null default 'character' check (role in ('artist','featured','character')),
  identity_prompt text not null default '',
  identity_profile jsonb not null default '{}'::jsonb,
  reference_asset_ids jsonb not null default '[]'::jsonb,
  approved_asset_ids jsonb not null default '[]'::jsonb,
  continuity_notes text,
  style_lock_strength numeric(5,4) not null default 0.85 check (style_lock_strength between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.music_video_projects
  add column if not exists editor_state jsonb not null default '{"zoom":1,"snap_mode":"smart","show_beats":true,"show_stems":true,"show_lyrics":true,"selected_tool":"select"}'::jsonb;

alter table public.music_video_shots
  add column if not exists shot_type text not null default 'generated'
    check (shot_type in ('generated','performance','source_media','graphic','hold')),
  add column if not exists character_id uuid references public.music_video_characters(id) on delete set null,
  add column if not exists performance_config jsonb not null default '{}'::jsonb,
  add column if not exists editor_config jsonb not null default '{}'::jsonb,
  add column if not exists lyrics_config jsonb not null default '{}'::jsonb,
  add column if not exists music_reactivity jsonb not null default '{}'::jsonb,
  add column if not exists quality_checks jsonb not null default '{}'::jsonb;

create index music_video_characters_project_idx
  on public.music_video_characters(project_id, created_at);
create index music_video_characters_artist_idx
  on public.music_video_characters(artist_id, created_at);
create index music_video_shots_character_idx
  on public.music_video_shots(character_id) where character_id is not null;

create or replace function private.validate_music_video_character_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_artist uuid;
begin
  select p.owner_id, r.artist_id into v_owner, v_artist
  from public.music_video_projects p
  join public.releases r on r.id = p.release_id
  where p.id = new.project_id;

  if v_owner is null or v_artist is null then
    raise exception 'Video character project must resolve to an artist';
  end if;
  if new.owner_id <> v_owner then
    raise exception 'Video character owner must match project owner';
  end if;
  if new.artist_id <> v_artist then
    raise exception 'Video character artist must match project artist';
  end if;
  if jsonb_typeof(new.reference_asset_ids) <> 'array' or jsonb_typeof(new.approved_asset_ids) <> 'array' then
    raise exception 'Video character reference collections must be arrays';
  end if;
  return new;
end;
$$;

create trigger music_video_characters_validate_scope
  before insert or update of owner_id, artist_id, project_id, reference_asset_ids, approved_asset_ids
  on public.music_video_characters
  for each row execute function private.validate_music_video_character_scope();

create or replace function private.validate_music_video_shot_character()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project uuid;
begin
  if new.character_id is null then return new; end if;
  select c.project_id into v_project
  from public.music_video_characters c
  where c.id = new.character_id and c.owner_id = new.owner_id;
  if v_project is null or v_project <> new.project_id then
    raise exception 'Video shot character must belong to the same project';
  end if;
  return new;
end;
$$;

create trigger music_video_shots_validate_character
  before insert or update of owner_id, project_id, character_id
  on public.music_video_shots
  for each row execute function private.validate_music_video_shot_character();

alter table public.music_video_characters enable row level security;
create policy "admins select own music_video_characters"
  on public.music_video_characters for select to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins insert own music_video_characters"
  on public.music_video_characters for insert to authenticated
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins update own music_video_characters"
  on public.music_video_characters for update to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins delete own music_video_characters"
  on public.music_video_characters for delete to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin());

create trigger set_music_video_characters_updated_at
  before update on public.music_video_characters
  for each row execute function private.set_updated_at();

grant select, insert, update, delete on public.music_video_characters to authenticated;
