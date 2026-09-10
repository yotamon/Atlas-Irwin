-- Atlas Stem Intelligence
-- First-class stems and reusable Audio Scenes bound to the exact current master.

create table public.track_stems (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete restrict,
  source_provider text not null default 'manual'
    check (source_provider in ('manual','suno','cubase','ableton','logic','other')),
  category text not null default 'other'
    check (category in ('vocals','drums','bass','percussion','guitar','keys','synth','strings','brass','woodwinds','fx','other')),
  label text not null,
  source_filename text,
  display_order integer not null default 0 check (display_order >= 0),
  status text not null default 'uploaded'
    check (status in ('uploaded','queued','analyzing','ready','failed','stale')),
  source_master_url text not null,
  source_master_media_asset_id uuid references public.media_assets(id) on delete set null,
  source_stem_sha256 text,
  analysis_pcm_sha256 text,
  duration_ms integer check (duration_ms is null or duration_ms > 0),
  sample_rate integer check (sample_rate is null or sample_rate > 0),
  channels integer check (channels is null or channels > 0),
  offset_ms integer not null default 0,
  alignment_confidence numeric(5,4) check (alignment_confidence is null or alignment_confidence between 0 and 1),
  analysis_version integer not null default 1 check (analysis_version > 0),
  analysis jsonb not null default '{}'::jsonb,
  alignment jsonb not null default '{}'::jsonb,
  user_overrides jsonb not null default '{}'::jsonb,
  error text,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(track_id, media_asset_id)
);

create table public.audio_scenes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  name text not null,
  scene_type text not null
    check (scene_type in (
      'vocal_spotlight','groove','atmosphere','instrument_spotlight','voiceover_bed',
      'progressive_reveal','vocal_to_drop','full_impact','custom'
    )),
  source text not null default 'system' check (source in ('system','user')),
  status text not null default 'ready' check (status in ('ready','stale','rendering','failed')),
  description text,
  recipe_version integer not null default 1 check (recipe_version > 0),
  recipe jsonb not null default '{}'::jsonb,
  objective_tags text[] not null default '{}',
  platform_hints text[] not null default '{}',
  recommended_start_ms integer check (recommended_start_ms is null or recommended_start_ms >= 0),
  recommended_end_ms integer,
  score numeric(5,4) check (score is null or score between 0 and 1),
  rationale jsonb not null default '{}'::jsonb,
  stem_set_fingerprint text,
  preview_asset_id uuid references public.media_assets(id) on delete set null,
  preview_error text,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (recommended_end_ms is null or recommended_start_ms is null or recommended_end_ms > recommended_start_ms)
);

create unique index audio_scenes_system_type_idx
  on public.audio_scenes(track_id, scene_type)
  where source = 'system';

create table public.track_stem_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  stem_id uuid references public.track_stems(id) on delete cascade,
  scene_id uuid references public.audio_scenes(id) on delete cascade,
  job_type text not null check (job_type in ('analyze_stem','render_audio_scene')),
  status text not null default 'planned'
    check (status in ('planned','queued','running','completed','failed','cancelled')),
  idempotency_key text not null unique,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  external_job_id text,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (job_type = 'analyze_stem' and stem_id is not null and scene_id is null)
    or (job_type = 'render_audio_scene' and scene_id is not null)
  )
);

create index track_stems_track_idx on public.track_stems(owner_id, track_id, display_order, created_at);
create index track_stems_status_idx on public.track_stems(track_id, status);
create index track_stems_asset_idx on public.track_stems(media_asset_id);
create index audio_scenes_track_idx on public.audio_scenes(owner_id, track_id, source, score desc nulls last);
create index audio_scenes_preview_idx on public.audio_scenes(preview_asset_id) where preview_asset_id is not null;
create index track_stem_jobs_queue_idx on public.track_stem_jobs(status, created_at) where status in ('planned','queued','running');
create index track_stem_jobs_track_idx on public.track_stem_jobs(owner_id, track_id, created_at desc);

alter table public.content_items
  add column if not exists audio_scene_id uuid references public.audio_scenes(id) on delete set null,
  add column if not exists audio_scene_source text check (audio_scene_source in ('manual','stem_intelligence')),
  add column if not exists audio_scene_reason text;

alter table public.music_video_projects
  add column if not exists audio_scene_id uuid references public.audio_scenes(id) on delete set null;

alter table public.music_video_renders
  add column if not exists audio_scene_id uuid references public.audio_scenes(id) on delete set null;

create or replace function private.validate_track_stem()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_track_owner uuid;
  v_master_url text;
  v_asset_owner uuid;
  v_asset_type text;
begin
  select t.owner_id, t.audio_url into v_track_owner, v_master_url
  from public.tracks t where t.id = new.track_id;
  if v_track_owner is null then raise exception 'Stem track must exist'; end if;
  if v_track_owner <> new.owner_id then raise exception 'Stem owner must match track owner'; end if;
  if v_master_url is null then raise exception 'Attach a canonical master before importing stems'; end if;
  if new.source_master_url is distinct from v_master_url then
    raise exception 'Stem must be bound to the current canonical master';
  end if;

  select a.owner_id, a.asset_type::text into v_asset_owner, v_asset_type
  from public.media_assets a where a.id = new.media_asset_id;
  if v_asset_owner is null then raise exception 'Stem media asset must exist'; end if;
  if v_asset_owner <> new.owner_id then raise exception 'Stem media asset owner must match track owner'; end if;
  if v_asset_type <> 'stem' then raise exception 'Stem media asset must use the stem asset type'; end if;
  return new;
end;
$$;

create trigger track_stems_validate_relations
  before insert or update of owner_id, track_id, media_asset_id, source_master_url
  on public.track_stems
  for each row execute function private.validate_track_stem();

create or replace function private.validate_audio_scene()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_track_owner uuid;
begin
  select t.owner_id into v_track_owner from public.tracks t where t.id = new.track_id;
  if v_track_owner is null then raise exception 'Audio Scene track must exist'; end if;
  if v_track_owner <> new.owner_id then raise exception 'Audio Scene owner must match track owner'; end if;
  if jsonb_typeof(new.recipe) <> 'object' then raise exception 'Audio Scene recipe must be an object'; end if;
  return new;
end;
$$;

create trigger audio_scenes_validate_relations
  before insert or update of owner_id, track_id, recipe
  on public.audio_scenes
  for each row execute function private.validate_audio_scene();

create or replace function private.validate_track_stem_job()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_track_owner uuid;
  v_stem_track uuid;
  v_scene_track uuid;
begin
  select t.owner_id into v_track_owner from public.tracks t where t.id = new.track_id;
  if v_track_owner is null or v_track_owner <> new.owner_id then
    raise exception 'Stem job owner must match track owner';
  end if;
  if new.stem_id is not null then
    select s.track_id into v_stem_track from public.track_stems s where s.id = new.stem_id and s.owner_id = new.owner_id;
    if v_stem_track is null or v_stem_track <> new.track_id then raise exception 'Stem job stem must belong to the same track'; end if;
  end if;
  if new.scene_id is not null then
    select s.track_id into v_scene_track from public.audio_scenes s where s.id = new.scene_id and s.owner_id = new.owner_id;
    if v_scene_track is null or v_scene_track <> new.track_id then raise exception 'Stem job scene must belong to the same track'; end if;
  end if;
  return new;
end;
$$;

create trigger track_stem_jobs_validate_relations
  before insert or update of owner_id, track_id, stem_id, scene_id, job_type
  on public.track_stem_jobs
  for each row execute function private.validate_track_stem_job();

create or replace function private.invalidate_stem_intelligence_on_audio_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.audio_url is not distinct from new.audio_url then return new; end if;

  update public.track_stems
  set status = 'stale',
      error = 'Canonical master changed. Re-import or explicitly rebind this stem before reuse.'
  where track_id = new.id and owner_id = new.owner_id;

  update public.audio_scenes
  set status = 'stale',
      preview_asset_id = null,
      preview_error = 'Canonical master changed. Regenerate this Audio Scene from current stems.'
  where track_id = new.id and owner_id = new.owner_id;

  update public.content_items c
  set audio_scene_id = null,
      audio_scene_source = null,
      audio_scene_reason = null
  where c.owner_id = new.owner_id
    and c.release_id = new.release_id
    and c.audio_scene_source = 'stem_intelligence';

  update public.music_video_projects
  set audio_scene_id = null
  where owner_id = new.owner_id and track_id = new.id;

  update public.music_video_renders r
  set audio_scene_id = null
  where r.owner_id = new.owner_id
    and exists (
      select 1 from public.music_video_projects p
      where p.id = r.project_id and p.track_id = new.id and p.owner_id = new.owner_id
    );

  update public.track_stem_jobs
  set status = 'cancelled',
      error = 'Canonical master changed before this Stem Intelligence job completed.',
      completed_at = now()
  where owner_id = new.owner_id
    and track_id = new.id
    and status in ('planned','queued','running');

  return new;
end;
$$;

revoke all on function private.invalidate_stem_intelligence_on_audio_change() from public, anon, authenticated;

drop trigger if exists invalidate_stem_intelligence_on_audio_change on public.tracks;
create trigger invalidate_stem_intelligence_on_audio_change
  after update of audio_url on public.tracks
  for each row execute function private.invalidate_stem_intelligence_on_audio_change();

do $$
declare
  t text;
begin
  foreach t in array array['track_stems','audio_scenes','track_stem_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "admins select own %1$s" on public.%1$I for select to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins insert own %1$s" on public.%1$I for insert to authenticated with check (owner_id = (select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins update own %1$s" on public.%1$I for update to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin()) with check (owner_id = (select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins delete own %1$s" on public.%1$I for delete to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin())', t);
    execute format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

grant select, insert, update, delete on public.track_stems, public.audio_scenes, public.track_stem_jobs to authenticated;
