-- Atlas Lyrics Intelligence
-- Canonical human lyrics remain durable truth. AI structure, semantic analysis and timing are
-- versioned derivatives that can be refreshed independently and safely invalidated.

create table public.track_lyrics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','verified','instrumental')),
  language text,
  canonical_text text not null default '',
  version integer not null default 1 check (version > 0),
  allow_ai_context boolean not null default true,
  allow_media_quotes boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(track_id),
  check (status = 'instrumental' or length(trim(canonical_text)) > 0),
  check (status <> 'instrumental' or length(trim(canonical_text)) = 0)
);

create table public.track_lyrics_revisions (
  id uuid primary key default gen_random_uuid(),
  lyrics_id uuid not null references public.track_lyrics(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null check (status in ('draft','verified','instrumental')),
  language text,
  canonical_text text not null,
  created_at timestamptz not null default now(),
  unique(lyrics_id, version)
);

create table public.track_lyric_sections (
  id uuid primary key default gen_random_uuid(),
  lyrics_id uuid not null references public.track_lyrics(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  lyrics_version integer not null check (lyrics_version > 0),
  section_key text not null,
  section_type text not null default 'other'
    check (section_type in ('intro','verse','pre_chorus','chorus','post_chorus','bridge','refrain','hook','outro','other')),
  label text not null,
  display_order integer not null check (display_order >= 0),
  text text not null,
  structure_source text not null default 'parser' check (structure_source in ('manual','parser','ai')),
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  is_primary_hook boolean not null default false,
  allow_media boolean not null default true,
  start_ms integer check (start_ms is null or start_ms >= 0),
  end_ms integer,
  timing_source text check (timing_source in ('manual','music_intelligence','alignment')),
  music_section_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lyrics_id, lyrics_version, section_key),
  check (end_ms is null or start_ms is null or end_ms > start_ms)
);

create table public.track_lyric_lines (
  id uuid primary key default gen_random_uuid(),
  lyrics_id uuid not null references public.track_lyrics(id) on delete cascade,
  section_id uuid not null references public.track_lyric_sections(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  lyrics_version integer not null check (lyrics_version > 0),
  display_order integer not null check (display_order >= 0),
  text text not null,
  allow_media boolean not null default true,
  start_ms integer check (start_ms is null or start_ms >= 0),
  end_ms integer,
  timing_source text check (timing_source in ('manual','music_intelligence','alignment')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_ms is null or start_ms is null or end_ms > start_ms)
);

create table public.track_lyrics_analysis (
  id uuid primary key default gen_random_uuid(),
  lyrics_id uuid not null references public.track_lyrics(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  lyrics_version integer not null check (lyrics_version > 0),
  prompt_version text not null,
  model text not null,
  provider text not null,
  request_id text,
  generation_run_id uuid,
  analysis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lyrics_id, lyrics_version)
);

create table public.track_lyric_moments (
  id uuid primary key default gen_random_uuid(),
  lyrics_id uuid not null references public.track_lyrics(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  lyrics_version integer not null check (lyrics_version > 0),
  section_key text,
  title text not null,
  excerpt text not null,
  interpretation text not null default '',
  purpose_tags text[] not null default '{}',
  visual_directions text[] not null default '{}',
  score numeric(5,4) not null default 0 check (score between 0 and 1),
  allow_media boolean not null default true,
  start_ms integer check (start_ms is null or start_ms >= 0),
  end_ms integer,
  timing_source text check (timing_source in ('manual','music_intelligence','alignment')),
  source_audio_url text,
  music_analysis_version integer check (music_analysis_version is null or music_analysis_version > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_ms is null or start_ms is null or end_ms > start_ms)
);

create index track_lyrics_owner_track_idx on public.track_lyrics(owner_id, track_id);
create index track_lyrics_revisions_idx on public.track_lyrics_revisions(lyrics_id, version desc);
create index track_lyric_sections_idx on public.track_lyric_sections(lyrics_id, lyrics_version, display_order);
create index track_lyric_lines_idx on public.track_lyric_lines(section_id, display_order);
create index track_lyrics_analysis_idx on public.track_lyrics_analysis(lyrics_id, lyrics_version desc);
create index track_lyric_moments_idx on public.track_lyric_moments(track_id, lyrics_version, score desc);

create or replace function private.validate_track_lyrics_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select t.owner_id into v_owner from public.tracks t where t.id = new.track_id;
  if v_owner is null then raise exception 'Lyrics track must exist'; end if;
  if v_owner <> new.owner_id then raise exception 'Lyrics owner must match track owner'; end if;
  return new;
end;
$$;

create trigger track_lyrics_validate_owner
  before insert or update of owner_id, track_id on public.track_lyrics
  for each row execute function private.validate_track_lyrics_owner();

-- Atomic canonical save. The parser sends exact stanza/section text; the database owns versioning,
-- revision history and replacement of current derived structure.
create or replace function public.save_track_lyrics(
  p_track_id uuid,
  p_canonical_text text,
  p_language text,
  p_status text,
  p_allow_ai_context boolean,
  p_allow_media_quotes boolean,
  p_sections jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_id uuid;
  v_old public.track_lyrics%rowtype;
  v_version integer := 1;
  v_changed boolean := true;
  v_section jsonb;
  v_section_id uuid;
  v_line jsonb;
begin
  if v_owner is null or not private.is_studio_admin() then raise exception 'Studio admin required'; end if;
  if p_status not in ('draft','verified','instrumental') then raise exception 'Invalid lyrics status'; end if;

  select t.owner_id into v_owner from public.tracks t where t.id = p_track_id and t.owner_id = auth.uid();
  if v_owner is null then raise exception 'Track not found'; end if;

  p_canonical_text := case when p_status = 'instrumental' then '' else trim(coalesce(p_canonical_text, '')) end;
  p_language := nullif(trim(coalesce(p_language, '')), '');
  if p_status <> 'instrumental' and p_canonical_text = '' then raise exception 'Lyrics cannot be empty'; end if;
  if jsonb_typeof(coalesce(p_sections, '[]'::jsonb)) <> 'array' then raise exception 'Lyrics sections must be an array'; end if;

  select * into v_old from public.track_lyrics where track_id = p_track_id for update;
  if found then
    v_changed := v_old.canonical_text is distinct from p_canonical_text
      or v_old.language is distinct from p_language
      or v_old.status is distinct from p_status;
    v_version := case when v_changed then v_old.version + 1 else v_old.version end;
    update public.track_lyrics
    set canonical_text = p_canonical_text,
        language = p_language,
        status = p_status,
        version = v_version,
        allow_ai_context = coalesce(p_allow_ai_context, true),
        allow_media_quotes = coalesce(p_allow_media_quotes, true),
        updated_at = now()
    where id = v_old.id
    returning id into v_id;
  else
    insert into public.track_lyrics(owner_id, track_id, status, language, canonical_text, version, allow_ai_context, allow_media_quotes)
    values (auth.uid(), p_track_id, p_status, p_language, p_canonical_text, 1, coalesce(p_allow_ai_context, true), coalesce(p_allow_media_quotes, true))
    returning id into v_id;
  end if;

  if v_changed or not exists (select 1 from public.track_lyrics_revisions where lyrics_id = v_id and version = v_version) then
    insert into public.track_lyrics_revisions(lyrics_id, owner_id, version, status, language, canonical_text)
    values (v_id, auth.uid(), v_version, p_status, p_language, p_canonical_text)
    on conflict (lyrics_id, version) do nothing;
  end if;

  if p_status = 'instrumental' then
    delete from public.track_lyric_moments where lyrics_id = v_id;
    delete from public.track_lyric_sections where lyrics_id = v_id;
    return v_id;
  end if;

  if v_changed or not exists (select 1 from public.track_lyric_sections where lyrics_id = v_id and lyrics_version = v_version) then
    delete from public.track_lyric_moments where lyrics_id = v_id;
    delete from public.track_lyric_sections where lyrics_id = v_id;

    for v_section in select value from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) loop
      insert into public.track_lyric_sections(
        lyrics_id, owner_id, lyrics_version, section_key, section_type, label, display_order, text,
        structure_source, confidence, is_primary_hook, allow_media
      ) values (
        v_id,
        auth.uid(),
        v_version,
        coalesce(nullif(v_section->>'section_key',''), 'section_' || coalesce(v_section->>'display_order','0')),
        case when v_section->>'section_type' in ('intro','verse','pre_chorus','chorus','post_chorus','bridge','refrain','hook','outro','other') then v_section->>'section_type' else 'other' end,
        coalesce(nullif(v_section->>'label',''), 'Section'),
        greatest(0, coalesce((v_section->>'display_order')::integer, 0)),
        coalesce(v_section->>'text',''),
        case when v_section->>'structure_source' in ('manual','parser','ai') then v_section->>'structure_source' else 'parser' end,
        case when v_section ? 'confidence' then greatest(0, least(1, (v_section->>'confidence')::numeric)) else null end,
        coalesce((v_section->>'is_primary_hook')::boolean, false),
        coalesce((v_section->>'allow_media')::boolean, true)
      ) returning id into v_section_id;

      if jsonb_typeof(v_section->'lines') = 'array' then
        for v_line in select value from jsonb_array_elements(v_section->'lines') loop
          if length(trim(coalesce(v_line->>'text',''))) > 0 then
            insert into public.track_lyric_lines(
              lyrics_id, section_id, owner_id, lyrics_version, display_order, text, allow_media
            ) values (
              v_id,
              v_section_id,
              auth.uid(),
              v_version,
              greatest(0, coalesce((v_line->>'display_order')::integer, 0)),
              v_line->>'text',
              coalesce((v_line->>'allow_media')::boolean, true)
            );
          end if;
        end loop;
      end if;
    end loop;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_track_lyrics(uuid,text,text,text,boolean,boolean,jsonb) from public, anon;
grant execute on function public.save_track_lyrics(uuid,text,text,text,boolean,boolean,jsonb) to authenticated;

-- Replacing the master never destroys lyrics or semantic analysis. Only timing that Atlas derived
-- from the old master is cleared; manual timing remains intentionally untouched.
create or replace function private.invalidate_lyric_timing_on_audio_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.audio_url is not distinct from new.audio_url then return new; end if;

  update public.track_lyric_sections s
  set start_ms = null,
      end_ms = null,
      timing_source = null,
      music_section_id = null
  where s.owner_id = new.owner_id
    and s.timing_source in ('music_intelligence','alignment')
    and exists (select 1 from public.track_lyrics l where l.id = s.lyrics_id and l.track_id = new.id);

  update public.track_lyric_lines line
  set start_ms = null,
      end_ms = null,
      timing_source = null
  where line.owner_id = new.owner_id
    and line.timing_source in ('music_intelligence','alignment')
    and exists (select 1 from public.track_lyrics l where l.id = line.lyrics_id and l.track_id = new.id);

  update public.track_lyric_moments
  set start_ms = null,
      end_ms = null,
      timing_source = null,
      source_audio_url = null,
      music_analysis_version = null,
      updated_at = now()
  where owner_id = new.owner_id
    and track_id = new.id
    and timing_source in ('music_intelligence','alignment');

  return new;
end;
$$;

revoke all on function private.invalidate_lyric_timing_on_audio_change() from public, anon, authenticated;

drop trigger if exists invalidate_lyric_timing_on_audio_change on public.tracks;
create trigger invalidate_lyric_timing_on_audio_change
  after update of audio_url on public.tracks
  for each row execute function private.invalidate_lyric_timing_on_audio_change();

do $$
declare
  t text;
begin
  foreach t in array array[
    'track_lyrics','track_lyrics_revisions','track_lyric_sections','track_lyric_lines',
    'track_lyrics_analysis','track_lyric_moments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "admins select own %1$s" on public.%1$I for select to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins insert own %1$s" on public.%1$I for insert to authenticated with check (owner_id = (select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins update own %1$s" on public.%1$I for update to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin()) with check (owner_id = (select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins delete own %1$s" on public.%1$I for delete to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin())', t);
    execute format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

grant select, insert, update, delete on public.track_lyrics, public.track_lyrics_revisions,
  public.track_lyric_sections, public.track_lyric_lines, public.track_lyrics_analysis,
  public.track_lyric_moments to authenticated;