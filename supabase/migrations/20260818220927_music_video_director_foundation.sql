-- Atlas Video Director foundation

alter type public.media_asset_type add value if not exists 'video_reference';
alter type public.media_asset_type add value if not exists 'storyboard_frame';
alter type public.media_asset_type add value if not exists 'shot_preview';
alter type public.media_asset_type add value if not exists 'shot_final';
alter type public.media_asset_type add value if not exists 'music_video_master';
alter type public.media_asset_type add value if not exists 'social_cut';
alter type public.media_asset_type add value if not exists 'thumbnail';

create type public.music_video_project_status as enum (
  'draft',
  'analyzing_audio',
  'concept_review',
  'treatment_review',
  'production_plan_review',
  'look_dev',
  'look_review',
  'test_generation',
  'test_review',
  'production',
  'shot_review',
  'ready_to_render',
  'rendering',
  'complete',
  'blocked',
  'failed',
  'archived'
);

create type public.music_video_concept_status as enum (
  'draft', 'selected', 'rejected', 'superseded'
);

create type public.music_video_shot_status as enum (
  'planned',
  'ready_for_reference',
  'ready_for_generation',
  'queued',
  'generating',
  'review',
  'locked',
  'rejected',
  'failed',
  'omitted'
);

create table public.music_video_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  release_id uuid not null references public.releases(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  title text not null,
  status public.music_video_project_status not null default 'draft',
  project_kind text not null default 'full_music_video' check (project_kind in ('full_music_video', 'teaser')),
  primary_aspect_ratio text not null default '16:9' check (primary_aspect_ratio in ('16:9', '9:16', '1:1')),
  target_resolution text not null default '1080p' check (target_resolution in ('720p', '1080p', '4k')),
  creative_brief jsonb not null default '{}',
  music_map jsonb not null default '{}',
  visual_bible jsonb not null default '{}',
  hard_budget_credits numeric(12,2) not null default 0 check (hard_budget_credits >= 0),
  estimated_credits numeric(12,2) not null default 0 check (estimated_credits >= 0),
  spent_credits numeric(12,2) not null default 0 check (spent_credits >= 0),
  reserved_credits numeric(12,2) not null default 0 check (reserved_credits >= 0),
  selected_concept_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.music_video_concepts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.music_video_projects(id) on delete cascade,
  round_number integer not null default 1 check (round_number > 0),
  display_order integer not null default 0 check (display_order >= 0),
  title text not null,
  premise text,
  concept_data jsonb not null default '{}',
  treatment text,
  status public.music_video_concept_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, round_number, display_order)
);

alter table public.music_video_projects
  add constraint music_video_projects_selected_concept_fk
  foreign key (selected_concept_id)
  references public.music_video_concepts(id)
  on delete set null;

create table public.music_video_scenes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.music_video_projects(id) on delete cascade,
  display_order integer not null default 0 check (display_order >= 0),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null,
  title text not null,
  description text,
  visual_intent jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_ms > start_ms)
);

create table public.music_video_shots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.music_video_projects(id) on delete cascade,
  scene_id uuid references public.music_video_scenes(id) on delete set null,
  display_order integer not null default 0 check (display_order >= 0),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null,
  description text not null,
  prompt text,
  negative_prompt text,
  capability_profile jsonb not null default '{}',
  selected_provider text,
  selected_model text,
  generation_params jsonb not null default '{}',
  start_asset_id uuid references public.media_assets(id) on delete set null,
  end_asset_id uuid references public.media_assets(id) on delete set null,
  selected_asset_id uuid references public.media_assets(id) on delete set null,
  continuity_from_shot_id uuid references public.music_video_shots(id) on delete set null,
  status public.music_video_shot_status not null default 'planned',
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_ms > start_ms)
);

create table public.music_video_approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.music_video_projects(id) on delete cascade,
  approval_type text not null check (approval_type in ('concept', 'production_plan', 'look', 'generation_batch', 'render')),
  scope jsonb not null default '{}',
  max_credits numeric(12,2) not null default 0 check (max_credits >= 0),
  consumed_credits numeric(12,2) not null default 0 check (consumed_credits >= 0 and consumed_credits <= max_credits),
  status text not null default 'active' check (status in ('active', 'consumed', 'revoked', 'expired')),
  approved_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.music_video_generations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.music_video_projects(id) on delete cascade,
  shot_id uuid references public.music_video_shots(id) on delete set null,
  operation_type text not null check (operation_type in ('look_image', 'test_video', 'shot_video', 'reframe', 'other')),
  provider text not null,
  model text not null,
  request_payload jsonb not null default '{}',
  provider_request_id text,
  idempotency_key text not null unique,
  approval_id uuid references public.music_video_approvals(id) on delete restrict,
  estimated_credits numeric(12,2) not null default 0 check (estimated_credits >= 0),
  actual_credits numeric(12,2) check (actual_credits is null or actual_credits >= 0),
  billing_status text not null default 'unconfirmed' check (billing_status in ('unconfirmed', 'reserved', 'charged', 'refunded', 'not_billed')),
  status text not null default 'planned' check (status in ('planned', 'approved', 'submitted', 'queued', 'in_progress', 'completed', 'failed', 'refunded', 'rejected_by_provider')),
  result_asset_id uuid references public.media_assets(id) on delete set null,
  provider_metadata jsonb not null default '{}',
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.music_video_renders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.music_video_projects(id) on delete cascade,
  render_type text not null check (render_type in ('master_16_9', 'social_9_16', 'promo_30', 'hook_15')),
  render_spec jsonb not null default '{}',
  status text not null default 'planned' check (status in ('planned', 'queued', 'rendering', 'completed', 'failed')),
  worker_job_id text,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index music_video_projects_release_idx on public.music_video_projects(owner_id, release_id, created_at desc);
create index music_video_projects_track_idx on public.music_video_projects(owner_id, track_id, created_at desc);
create index music_video_projects_status_idx on public.music_video_projects(owner_id, status);
create index music_video_concepts_project_idx on public.music_video_concepts(project_id, round_number, display_order);
create index music_video_scenes_project_idx on public.music_video_scenes(project_id, display_order);
create index music_video_shots_project_idx on public.music_video_shots(project_id, display_order);
create index music_video_shots_status_idx on public.music_video_shots(project_id, status);
create index music_video_approvals_project_idx on public.music_video_approvals(project_id, status);
create index music_video_generations_project_idx on public.music_video_generations(project_id, created_at desc);
create index music_video_generations_shot_idx on public.music_video_generations(shot_id, created_at desc) where shot_id is not null;
create index music_video_renders_project_idx on public.music_video_renders(project_id, created_at desc);

create function private.validate_music_video_project() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  track_release_id uuid;
  track_owner_id uuid;
  release_owner_id uuid;
begin
  select t.release_id, t.owner_id into track_release_id, track_owner_id
  from public.tracks t where t.id = new.track_id;

  select r.owner_id into release_owner_id
  from public.releases r where r.id = new.release_id;

  if track_release_id is null or release_owner_id is null then
    raise exception 'Video project release and track must exist';
  end if;

  if track_release_id <> new.release_id then
    raise exception 'Video project track must belong to the selected release';
  end if;

  if track_owner_id <> new.owner_id or release_owner_id <> new.owner_id then
    raise exception 'Video project owner must match release and track owner';
  end if;

  return new;
end $$;

create trigger music_video_projects_validate_relations
  before insert or update of owner_id, release_id, track_id on public.music_video_projects
  for each row execute function private.validate_music_video_project();

create function private.validate_music_video_child_owner() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  project_owner_id uuid;
begin
  select p.owner_id into project_owner_id
  from public.music_video_projects p where p.id = new.project_id;

  if project_owner_id is null then
    raise exception 'Video project must exist';
  end if;

  if project_owner_id <> new.owner_id then
    raise exception 'Video child owner must match project owner';
  end if;

  return new;
end $$;

create function private.validate_music_video_shot_scene() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  scene_project_id uuid;
begin
  if new.scene_id is null then
    return new;
  end if;

  select s.project_id into scene_project_id
  from public.music_video_scenes s where s.id = new.scene_id;

  if scene_project_id is null or scene_project_id <> new.project_id then
    raise exception 'Video shot scene must belong to the same project';
  end if;

  return new;
end $$;

create trigger music_video_concepts_validate_owner
  before insert or update of owner_id, project_id on public.music_video_concepts
  for each row execute function private.validate_music_video_child_owner();
create trigger music_video_scenes_validate_owner
  before insert or update of owner_id, project_id on public.music_video_scenes
  for each row execute function private.validate_music_video_child_owner();
create trigger music_video_shots_validate_owner
  before insert or update of owner_id, project_id on public.music_video_shots
  for each row execute function private.validate_music_video_child_owner();
create trigger music_video_approvals_validate_owner
  before insert or update of owner_id, project_id on public.music_video_approvals
  for each row execute function private.validate_music_video_child_owner();
create trigger music_video_generations_validate_owner
  before insert or update of owner_id, project_id on public.music_video_generations
  for each row execute function private.validate_music_video_child_owner();
create trigger music_video_renders_validate_owner
  before insert or update of owner_id, project_id on public.music_video_renders
  for each row execute function private.validate_music_video_child_owner();

create trigger music_video_shots_validate_scene
  before insert or update of project_id, scene_id on public.music_video_shots
  for each row execute function private.validate_music_video_shot_scene();

create function private.validate_music_video_selected_concept() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  concept_project_id uuid;
begin
  if new.selected_concept_id is null then
    return new;
  end if;

  select c.project_id into concept_project_id
  from public.music_video_concepts c where c.id = new.selected_concept_id;

  if concept_project_id is null or concept_project_id <> new.id then
    raise exception 'Selected concept must belong to the same video project';
  end if;

  return new;
end $$;

create trigger music_video_projects_validate_selected_concept
  before insert or update of selected_concept_id on public.music_video_projects
  for each row execute function private.validate_music_video_selected_concept();

do $$
declare
  t text;
begin
  foreach t in array array[
    'music_video_projects',
    'music_video_concepts',
    'music_video_scenes',
    'music_video_shots',
    'music_video_approvals',
    'music_video_generations',
    'music_video_renders'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "admins select own %1$s" on public.%1$I for select to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins insert own %1$s" on public.%1$I for insert to authenticated with check (owner_id = (select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins update own %1$s" on public.%1$I for update to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin()) with check (owner_id = (select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins delete own %1$s" on public.%1$I for delete to authenticated using (owner_id = (select auth.uid()) and private.is_studio_admin())', t);
    execute format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

grant select, insert, update, delete on
  public.music_video_projects,
  public.music_video_concepts,
  public.music_video_scenes,
  public.music_video_shots,
  public.music_video_approvals,
  public.music_video_generations,
  public.music_video_renders
  to authenticated;
