-- Atlas Video Director integrity hardening

alter table public.music_video_projects
  add constraint music_video_projects_budget_capacity_check
  check (spent_credits + reserved_credits <= hard_budget_credits);

alter table public.music_video_renders
  alter column worker_job_id type uuid using nullif(worker_job_id, '')::uuid;

alter table public.music_video_renders
  add constraint music_video_renders_worker_job_fk
  foreign key (worker_job_id)
  references public.music_video_worker_jobs(id)
  on delete set null;

create or replace function private.validate_music_video_shot_relations() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  related_project_id uuid;
  asset_owner_id uuid;
  reference_id_text text;
  reference_id uuid;
begin
  if new.continuity_from_shot_id is not null then
    if new.continuity_from_shot_id = new.id then
      raise exception 'A shot cannot continue from itself';
    end if;
    select s.project_id into related_project_id
    from public.music_video_shots s where s.id = new.continuity_from_shot_id;
    if related_project_id is null or related_project_id <> new.project_id then
      raise exception 'Continuity source shot must belong to the same project';
    end if;
  end if;

  if new.start_asset_id is not null then
    select a.owner_id into asset_owner_id from public.media_assets a where a.id = new.start_asset_id;
    if asset_owner_id is null or asset_owner_id <> new.owner_id then
      raise exception 'Start asset must belong to the project owner';
    end if;
  end if;

  if new.end_asset_id is not null then
    select a.owner_id into asset_owner_id from public.media_assets a where a.id = new.end_asset_id;
    if asset_owner_id is null or asset_owner_id <> new.owner_id then
      raise exception 'End asset must belong to the project owner';
    end if;
  end if;

  if new.selected_asset_id is not null then
    select a.owner_id into asset_owner_id from public.media_assets a where a.id = new.selected_asset_id;
    if asset_owner_id is null or asset_owner_id <> new.owner_id then
      raise exception 'Selected asset must belong to the project owner';
    end if;
  end if;

  if jsonb_typeof(new.reference_asset_ids) <> 'array' then
    raise exception 'reference_asset_ids must be a JSON array';
  end if;
  for reference_id_text in select value from jsonb_array_elements_text(new.reference_asset_ids) value loop
    begin
      reference_id := reference_id_text::uuid;
    exception when invalid_text_representation then
      raise exception 'Reference asset id must be a UUID';
    end;
    select a.owner_id into asset_owner_id from public.media_assets a where a.id = reference_id;
    if asset_owner_id is null or asset_owner_id <> new.owner_id then
      raise exception 'Reference asset must belong to the project owner';
    end if;
  end loop;

  return new;
end $$;

drop trigger if exists music_video_shots_validate_relations on public.music_video_shots;
create trigger music_video_shots_validate_relations
  before insert or update of owner_id, project_id, continuity_from_shot_id, start_asset_id, end_asset_id, selected_asset_id, reference_asset_ids
  on public.music_video_shots
  for each row execute function private.validate_music_video_shot_relations();

create or replace function private.validate_music_video_generation_relations() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  related_project_id uuid;
  related_owner_id uuid;
begin
  if new.shot_id is not null then
    select s.project_id, s.owner_id into related_project_id, related_owner_id
    from public.music_video_shots s where s.id = new.shot_id;
    if related_project_id is null or related_project_id <> new.project_id or related_owner_id <> new.owner_id then
      raise exception 'Generation shot must belong to the same project and owner';
    end if;
  end if;

  if new.approval_id is not null then
    select a.project_id, a.owner_id into related_project_id, related_owner_id
    from public.music_video_approvals a where a.id = new.approval_id;
    if related_project_id is null or related_project_id <> new.project_id or related_owner_id <> new.owner_id then
      raise exception 'Generation approval must belong to the same project and owner';
    end if;
  end if;

  if new.result_asset_id is not null then
    select a.owner_id into related_owner_id from public.media_assets a where a.id = new.result_asset_id;
    if related_owner_id is null or related_owner_id <> new.owner_id then
      raise exception 'Generation result asset must belong to the project owner';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists music_video_generations_validate_relations on public.music_video_generations;
create trigger music_video_generations_validate_relations
  before insert or update of owner_id, project_id, shot_id, approval_id, result_asset_id
  on public.music_video_generations
  for each row execute function private.validate_music_video_generation_relations();

create or replace function private.validate_music_video_render_relations() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  related_project_id uuid;
  related_owner_id uuid;
begin
  if new.worker_job_id is not null then
    select j.project_id, j.owner_id into related_project_id, related_owner_id
    from public.music_video_worker_jobs j where j.id = new.worker_job_id;
    if related_project_id is null or related_project_id <> new.project_id or related_owner_id <> new.owner_id then
      raise exception 'Render worker job must belong to the same project and owner';
    end if;
  end if;

  if new.media_asset_id is not null then
    select a.owner_id into related_owner_id from public.media_assets a where a.id = new.media_asset_id;
    if related_owner_id is null or related_owner_id <> new.owner_id then
      raise exception 'Render asset must belong to the project owner';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists music_video_renders_validate_relations on public.music_video_renders;
create trigger music_video_renders_validate_relations
  before insert or update of owner_id, project_id, worker_job_id, media_asset_id
  on public.music_video_renders
  for each row execute function private.validate_music_video_render_relations();

create or replace function private.music_video_scope_allows_generation(
  p_scope jsonb,
  p_generation_id uuid,
  p_shot_id uuid,
  p_operation_type text,
  p_model text
) returns boolean
language sql immutable set search_path = '' as $$
  select
    (
      coalesce(jsonb_array_length(coalesce(p_scope->'generation_ids', '[]'::jsonb)), 0) = 0
      or exists (
        select 1 from jsonb_array_elements_text(p_scope->'generation_ids') value
        where value = p_generation_id::text
      )
    )
    and (
      coalesce(jsonb_array_length(coalesce(p_scope->'shot_ids', '[]'::jsonb)), 0) = 0
      or p_shot_id is not null and exists (
        select 1 from jsonb_array_elements_text(p_scope->'shot_ids') value
        where value = p_shot_id::text
      )
    )
    and (
      coalesce(jsonb_array_length(coalesce(p_scope->'operation_types', '[]'::jsonb)), 0) = 0
      or exists (
        select 1 from jsonb_array_elements_text(p_scope->'operation_types') value
        where value = p_operation_type
      )
    )
    and (
      coalesce(jsonb_array_length(coalesce(p_scope->'models', '[]'::jsonb)), 0) = 0
      or exists (
        select 1 from jsonb_array_elements_text(p_scope->'models') value
        where value = p_model
      )
    );
$$;

create or replace function public.reserve_music_video_generation(
  p_generation_id uuid
) returns public.music_video_generations
language plpgsql security invoker set search_path = '' as $$
declare
  g public.music_video_generations;
  a public.music_video_approvals;
  p public.music_video_projects;
begin
  select * into g from public.music_video_generations
    where id = p_generation_id for update;
  if g.id is null then raise exception 'Generation not found'; end if;
  if g.status not in ('planned', 'approved') then
    raise exception 'Generation cannot be reserved from status %', g.status;
  end if;
  if g.approval_id is null then raise exception 'Paid generation requires approval'; end if;

  select * into a from public.music_video_approvals
    where id = g.approval_id for update;
  if a.id is null or a.project_id <> g.project_id or a.owner_id <> g.owner_id then
    raise exception 'Invalid approval';
  end if;
  if a.status <> 'active' then raise exception 'Approval is not active'; end if;
  if a.expires_at is not null and a.expires_at <= now() then raise exception 'Approval expired'; end if;
  if not private.music_video_scope_allows_generation(a.scope, g.id, g.shot_id, g.operation_type, g.model) then
    raise exception 'Generation falls outside approved scope';
  end if;
  if a.consumed_credits + a.reserved_credits + g.estimated_credits > a.max_credits then
    raise exception 'Approval credit envelope exceeded';
  end if;

  select * into p from public.music_video_projects
    where id = g.project_id for update;
  if p.id is null then raise exception 'Project not found'; end if;
  if p.status in ('archived', 'failed') then raise exception 'Project cannot spend credits in current status'; end if;
  if p.spent_credits + p.reserved_credits + g.estimated_credits > p.hard_budget_credits then
    raise exception 'Project hard budget exceeded';
  end if;

  update public.music_video_approvals
    set reserved_credits = reserved_credits + g.estimated_credits
    where id = a.id;
  update public.music_video_projects
    set reserved_credits = reserved_credits + g.estimated_credits
    where id = p.id;
  update public.music_video_generations
    set status = 'approved', billing_status = 'reserved'
    where id = g.id
    returning * into g;
  return g;
end $$;
