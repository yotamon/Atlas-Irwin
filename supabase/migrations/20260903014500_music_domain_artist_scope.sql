-- Ensemblis #70: make the canonical music graph explicitly artist-scoped.
--
-- Compatibility rule: owner_id remains in place while callers migrate. Existing callers may
-- omit artist_id only for the legacy/default artist mapped to their owner profile. New artist
-- workflows must provide artist_id explicitly at the release boundary; descendants inherit it.

create or replace function private.legacy_artist_for_owner(p_owner_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.artists a
  where a.legacy_owner_id = p_owner_id
  limit 1
$$;

create or replace function private.profile_can_manage_artist(p_profile_id uuid, p_artist_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.artists a
    join public.workspace_memberships m on m.workspace_id = a.workspace_id
    where a.id = p_artist_id
      and m.profile_id = p_profile_id
      and m.status = 'active'
  )
$$;

revoke all on function private.legacy_artist_for_owner(uuid) from public, anon, authenticated;
revoke all on function private.profile_can_manage_artist(uuid, uuid) from public, anon, authenticated;

alter table public.releases add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.tracks add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.track_music_intelligence add column if not exists artist_id uuid references public.artists(id) on delete restrict;

alter table public.track_lyrics add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.track_lyrics_revisions add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.track_lyric_sections add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.track_lyric_lines add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.track_lyrics_analysis add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.track_lyric_moments add column if not exists artist_id uuid references public.artists(id) on delete restrict;

alter table public.track_stems add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.audio_scenes add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.track_stem_jobs add column if not exists artist_id uuid references public.artists(id) on delete restrict;

alter table public.track_external_ids add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.release_external_links add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.homepage_placements add column if not exists artist_id uuid references public.artists(id) on delete restrict;

-- Backfill the release boundary from the deterministic legacy owner mapping.
update public.releases r
set artist_id = private.legacy_artist_for_owner(r.owner_id)
where r.artist_id is null;

-- Every descendant derives scope from its canonical parent, never independently from owner_id.
update public.tracks t
set artist_id = r.artist_id
from public.releases r
where r.id = t.release_id and t.artist_id is null;

update public.track_music_intelligence i
set artist_id = t.artist_id
from public.tracks t
where t.id = i.track_id and i.artist_id is null;

update public.track_lyrics l
set artist_id = t.artist_id
from public.tracks t
where t.id = l.track_id and l.artist_id is null;

update public.track_lyrics_revisions r
set artist_id = l.artist_id
from public.track_lyrics l
where l.id = r.lyrics_id and r.artist_id is null;

update public.track_lyric_sections s
set artist_id = l.artist_id
from public.track_lyrics l
where l.id = s.lyrics_id and s.artist_id is null;

update public.track_lyric_lines line
set artist_id = l.artist_id
from public.track_lyrics l
where l.id = line.lyrics_id and line.artist_id is null;

update public.track_lyrics_analysis a
set artist_id = l.artist_id
from public.track_lyrics l
where l.id = a.lyrics_id and a.artist_id is null;

update public.track_lyric_moments m
set artist_id = t.artist_id
from public.tracks t
where t.id = m.track_id and m.artist_id is null;

update public.track_stems s
set artist_id = t.artist_id
from public.tracks t
where t.id = s.track_id and s.artist_id is null;

update public.audio_scenes s
set artist_id = t.artist_id
from public.tracks t
where t.id = s.track_id and s.artist_id is null;

update public.track_stem_jobs j
set artist_id = t.artist_id
from public.tracks t
where t.id = j.track_id and j.artist_id is null;

update public.track_external_ids e
set artist_id = t.artist_id
from public.tracks t
where t.id = e.track_id and e.artist_id is null;

update public.release_external_links e
set artist_id = r.artist_id
from public.releases r
where r.id = e.release_id and e.artist_id is null;

update public.homepage_placements p
set artist_id = r.artist_id
from public.releases r
where r.id = p.release_id and p.artist_id is null;

-- Abort the migration rather than leaving a partially artist-scoped catalog.
do $$
declare
  t text;
  missing_count bigint;
begin
  foreach t in array array[
    'releases','tracks','track_music_intelligence','track_lyrics','track_lyrics_revisions',
    'track_lyric_sections','track_lyric_lines','track_lyrics_analysis','track_lyric_moments',
    'track_stems','audio_scenes','track_stem_jobs','track_external_ids',
    'release_external_links','homepage_placements'
  ] loop
    execute format('select count(*) from public.%I where artist_id is null', t) into missing_count;
    if missing_count > 0 then
      raise exception 'Ensemblis artist backfill failed for table % (% rows)', t, missing_count;
    end if;
  end loop;
end $$;

create or replace function private.validate_release_artist_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_artist_name text;
begin
  if new.artist_id is null then
    new.artist_id := private.legacy_artist_for_owner(new.owner_id);
  end if;
  if new.artist_id is null then
    raise exception 'artist_id is required for releases outside the legacy artist compatibility path';
  end if;
  if not private.profile_can_manage_artist(new.owner_id, new.artist_id) then
    raise exception 'Release owner must be an active member of the artist workspace';
  end if;
  select a.name into v_artist_name from public.artists a where a.id = new.artist_id;
  if v_artist_name is null then raise exception 'Release artist must exist'; end if;
  -- Keep the legacy public-catalog display field synchronized during the transition.
  new.artist := v_artist_name;
  return new;
end;
$$;

create or replace function private.validate_track_artist_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_artist_id uuid;
  v_owner_id uuid;
begin
  select r.artist_id, r.owner_id into v_artist_id, v_owner_id
  from public.releases r where r.id = new.release_id;
  if v_artist_id is null then raise exception 'Track release must exist and be artist-scoped'; end if;
  if new.artist_id is not null and new.artist_id <> v_artist_id then
    raise exception 'Track artist must match release artist';
  end if;
  if new.owner_id <> v_owner_id then raise exception 'Track owner must match release owner during compatibility migration'; end if;
  new.artist_id := v_artist_id;
  return new;
end;
$$;

create or replace function private.validate_track_child_artist_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_artist_id uuid;
begin
  select t.artist_id into v_artist_id from public.tracks t where t.id = new.track_id;
  if v_artist_id is null then raise exception '% track must exist and be artist-scoped', tg_table_name; end if;
  if new.artist_id is not null and new.artist_id <> v_artist_id then
    raise exception '% artist must match track artist', tg_table_name;
  end if;
  new.artist_id := v_artist_id;
  return new;
end;
$$;

create or replace function private.validate_lyrics_child_artist_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_artist_id uuid;
begin
  select l.artist_id into v_artist_id from public.track_lyrics l where l.id = new.lyrics_id;
  if v_artist_id is null then raise exception '% lyrics must exist and be artist-scoped', tg_table_name; end if;
  if new.artist_id is not null and new.artist_id <> v_artist_id then
    raise exception '% artist must match canonical lyrics artist', tg_table_name;
  end if;
  new.artist_id := v_artist_id;
  return new;
end;
$$;

create or replace function private.validate_release_child_artist_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_artist_id uuid;
begin
  select r.artist_id into v_artist_id from public.releases r where r.id = new.release_id;
  if v_artist_id is null then raise exception '% release must exist and be artist-scoped', tg_table_name; end if;
  if new.artist_id is not null and new.artist_id <> v_artist_id then
    raise exception '% artist must match release artist', tg_table_name;
  end if;
  new.artist_id := v_artist_id;
  return new;
end;
$$;

revoke all on function private.validate_release_artist_scope() from public, anon, authenticated;
revoke all on function private.validate_track_artist_scope() from public, anon, authenticated;
revoke all on function private.validate_track_child_artist_scope() from public, anon, authenticated;
revoke all on function private.validate_lyrics_child_artist_scope() from public, anon, authenticated;
revoke all on function private.validate_release_child_artist_scope() from public, anon, authenticated;

drop trigger if exists releases_validate_artist_scope on public.releases;
create trigger releases_validate_artist_scope
  before insert or update of owner_id, artist_id, artist on public.releases
  for each row execute function private.validate_release_artist_scope();

drop trigger if exists tracks_validate_artist_scope on public.tracks;
create trigger tracks_validate_artist_scope
  before insert or update of owner_id, release_id, artist_id on public.tracks
  for each row execute function private.validate_track_artist_scope();

do $$
declare
  t text;
begin
  foreach t in array array[
    'track_music_intelligence','track_lyrics','track_lyric_moments','track_stems',
    'audio_scenes','track_stem_jobs','track_external_ids'
  ] loop
    execute format('drop trigger if exists %1$I_validate_artist_scope on public.%1$I', t);
    execute format(
      'create trigger %1$I_validate_artist_scope before insert or update of track_id, artist_id on public.%1$I for each row execute function private.validate_track_child_artist_scope()',
      t
    );
  end loop;

  foreach t in array array[
    'track_lyrics_revisions','track_lyric_sections','track_lyric_lines','track_lyrics_analysis'
  ] loop
    execute format('drop trigger if exists %1$I_validate_artist_scope on public.%1$I', t);
    execute format(
      'create trigger %1$I_validate_artist_scope before insert or update of lyrics_id, artist_id on public.%1$I for each row execute function private.validate_lyrics_child_artist_scope()',
      t
    );
  end loop;

  foreach t in array array['release_external_links','homepage_placements'] loop
    execute format('drop trigger if exists %1$I_validate_artist_scope on public.%1$I', t);
    execute format(
      'create trigger %1$I_validate_artist_scope before insert or update of release_id, artist_id on public.%1$I for each row execute function private.validate_release_child_artist_scope()',
      t
    );
  end loop;
end $$;

-- Artist deletion is intentionally restricted by the FK. Archive artists instead of cascading catalog deletion.
alter table public.releases alter column artist_id set not null;
alter table public.tracks alter column artist_id set not null;
alter table public.track_music_intelligence alter column artist_id set not null;
alter table public.track_lyrics alter column artist_id set not null;
alter table public.track_lyrics_revisions alter column artist_id set not null;
alter table public.track_lyric_sections alter column artist_id set not null;
alter table public.track_lyric_lines alter column artist_id set not null;
alter table public.track_lyrics_analysis alter column artist_id set not null;
alter table public.track_lyric_moments alter column artist_id set not null;
alter table public.track_stems alter column artist_id set not null;
alter table public.audio_scenes alter column artist_id set not null;
alter table public.track_stem_jobs alter column artist_id set not null;
alter table public.track_external_ids alter column artist_id set not null;
alter table public.release_external_links alter column artist_id set not null;
alter table public.homepage_placements alter column artist_id set not null;

create index if not exists releases_artist_status_date_idx on public.releases(artist_id, status, release_date);
create index if not exists tracks_artist_release_idx on public.tracks(artist_id, release_id);
create index if not exists track_music_intelligence_artist_idx on public.track_music_intelligence(artist_id, analyzed_at desc);
create index if not exists track_lyrics_artist_track_idx on public.track_lyrics(artist_id, track_id);
create index if not exists track_lyric_moments_artist_score_idx on public.track_lyric_moments(artist_id, track_id, score desc);
create index if not exists track_stems_artist_track_idx on public.track_stems(artist_id, track_id, display_order);
create index if not exists audio_scenes_artist_track_idx on public.audio_scenes(artist_id, track_id, score desc nulls last);
create index if not exists track_stem_jobs_artist_queue_idx on public.track_stem_jobs(artist_id, status, created_at);
create index if not exists track_external_ids_artist_idx on public.track_external_ids(artist_id, track_id);
create index if not exists release_external_links_artist_idx on public.release_external_links(artist_id, release_id);
create index if not exists homepage_placements_artist_idx on public.homepage_placements(artist_id, enabled, display_order);

-- Keep the public catalog's compatibility artist label current when the Ensemblis artist is renamed.
create or replace function private.sync_release_artist_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.name is distinct from new.name then
    update public.releases set artist = new.name, updated_at = now() where artist_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_release_artist_display_name() from public, anon, authenticated;

drop trigger if exists sync_release_artist_display_name on public.artists;
create trigger sync_release_artist_display_name
  after update of name on public.artists
  for each row execute function private.sync_release_artist_display_name();

-- Add artist-membership authorization alongside the legacy owner policies. The existing Studio
-- admin gate remains until collaborator onboarding is intentionally enabled.
do $$
declare
  t text;
begin
  foreach t in array array[
    'releases','tracks','track_music_intelligence','track_lyrics','track_lyrics_revisions',
    'track_lyric_sections','track_lyric_lines','track_lyrics_analysis','track_lyric_moments',
    'track_stems','audio_scenes','track_stem_jobs','track_external_ids',
    'release_external_links','homepage_placements'
  ] loop
    execute format('create policy "studio admins artist select %1$s" on public.%1$I for select to authenticated using (private.is_studio_admin() and private.can_access_artist(artist_id))', t);
    execute format('create policy "studio admins artist insert %1$s" on public.%1$I for insert to authenticated with check (private.is_studio_admin() and private.can_access_artist(artist_id))', t);
    execute format('create policy "studio admins artist update %1$s" on public.%1$I for update to authenticated using (private.is_studio_admin() and private.can_access_artist(artist_id)) with check (private.is_studio_admin() and private.can_access_artist(artist_id))', t);
    execute format('create policy "studio admins artist delete %1$s" on public.%1$I for delete to authenticated using (private.is_studio_admin() and private.can_access_artist(artist_id))', t);
  end loop;
end $$;
