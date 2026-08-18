-- Atlas Video Director production pipeline

alter table public.music_video_projects
  add column if not exists production_plan jsonb not null default '{}',
  add column if not exists director_notes jsonb not null default '{}',
  add column if not exists render_manifest jsonb not null default '{}',
  add column if not exists quality_profile text not null default 'balanced'
    check (quality_profile in ('economy', 'balanced', 'premium')),
  add column if not exists previous_status public.music_video_project_status,
  add column if not exists last_error text,
  add column if not exists analysis_requested_at timestamptz,
  add column if not exists analysis_completed_at timestamptz,
  add column if not exists creative_generated_at timestamptz;

alter table public.music_video_shots
  add column if not exists reference_asset_ids jsonb not null default '[]',
  add column if not exists reuse_strategy text not null default 'unique'
    check (reuse_strategy in ('unique', 'reuse_source', 'continuation', 'reframe', 'hold', 'loop')),
  add column if not exists generation_priority text not null default 'balanced'
    check (generation_priority in ('cost', 'balanced', 'quality', 'consistency', 'capability')),
  add column if not exists review_note text,
  add column if not exists music_context jsonb not null default '{}',
  add column if not exists prompt_version integer not null default 1 check (prompt_version > 0);

alter table public.music_video_approvals
  add column if not exists reserved_credits numeric(12,2) not null default 0
    check (reserved_credits >= 0 and consumed_credits + reserved_credits <= max_credits),
  add column if not exists revoked_at timestamptz,
  add column if not exists label text;

alter table public.music_video_generations
  add column if not exists retry_of_id uuid references public.music_video_generations(id) on delete set null,
  add column if not exists prompt_version integer not null default 1 check (prompt_version > 0),
  add column if not exists request_hash text,
  add column if not exists error text;

create index if not exists music_video_generations_provider_request_idx
  on public.music_video_generations(provider, provider_request_id)
  where provider_request_id is not null;

create table if not exists public.music_video_worker_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.music_video_projects(id) on delete cascade,
  job_type text not null check (job_type in (
    'analyze_audio',
    'extract_audio_segment',
    'extract_frame',
    'render_master',
    'render_social',
    'render_promo',
    'render_hook'
  )),
  status text not null default 'planned' check (status in (
    'planned', 'queued', 'running', 'completed', 'failed', 'cancelled'
  )),
  idempotency_key text not null unique,
  request_payload jsonb not null default '{}',
  result_payload jsonb not null default '{}',
  external_job_id text,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists music_video_worker_jobs_project_idx
  on public.music_video_worker_jobs(project_id, created_at desc);
create index if not exists music_video_worker_jobs_status_idx
  on public.music_video_worker_jobs(status, created_at);

create table if not exists public.music_video_director_preferences (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  positive_signals jsonb not null default '[]',
  negative_signals jsonb not null default '[]',
  feedback_history jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.music_video_worker_jobs enable row level security;
alter table public.music_video_director_preferences enable row level security;

create policy "admins select own music_video_worker_jobs"
  on public.music_video_worker_jobs for select to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins insert own music_video_worker_jobs"
  on public.music_video_worker_jobs for insert to authenticated
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins update own music_video_worker_jobs"
  on public.music_video_worker_jobs for update to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins delete own music_video_worker_jobs"
  on public.music_video_worker_jobs for delete to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin());

create policy "admins select own music_video_director_preferences"
  on public.music_video_director_preferences for select to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins insert own music_video_director_preferences"
  on public.music_video_director_preferences for insert to authenticated
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins update own music_video_director_preferences"
  on public.music_video_director_preferences for update to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());

create trigger set_music_video_worker_jobs_updated_at
  before update on public.music_video_worker_jobs
  for each row execute function private.set_updated_at();
create trigger set_music_video_director_preferences_updated_at
  before update on public.music_video_director_preferences
  for each row execute function private.set_updated_at();

create trigger music_video_worker_jobs_validate_owner
  before insert or update of owner_id, project_id on public.music_video_worker_jobs
  for each row execute function private.validate_music_video_child_owner();

grant select, insert, update, delete on public.music_video_worker_jobs to authenticated;
grant select, insert, update on public.music_video_director_preferences to authenticated;

-- Scope shape used by generation_batch approvals:
-- {
--   "shot_ids": ["uuid", ...],
--   "operation_types": ["look_image", "test_video", "shot_video", "reframe"],
--   "models": ["optional-model-id", ...]
-- }
create or replace function private.music_video_scope_allows_generation(
  p_scope jsonb,
  p_shot_id uuid,
  p_operation_type text,
  p_model text
) returns boolean
language sql immutable set search_path = '' as $$
  select
    (
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
  if a.id is null or a.project_id <> g.project_id then raise exception 'Invalid approval'; end if;
  if a.status <> 'active' then raise exception 'Approval is not active'; end if;
  if a.expires_at is not null and a.expires_at <= now() then raise exception 'Approval expired'; end if;
  if not private.music_video_scope_allows_generation(a.scope, g.shot_id, g.operation_type, g.model) then
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

create or replace function public.settle_music_video_generation(
  p_generation_id uuid,
  p_actual_credits numeric,
  p_billing_status text default 'charged'
) returns public.music_video_generations
language plpgsql security invoker set search_path = '' as $$
declare
  g public.music_video_generations;
  reserve_amount numeric;
  charge_amount numeric;
begin
  if p_actual_credits < 0 then raise exception 'Actual credits cannot be negative'; end if;
  if p_billing_status not in ('charged', 'not_billed', 'refunded') then
    raise exception 'Invalid billing status';
  end if;

  select * into g from public.music_video_generations
    where id = p_generation_id for update;
  if g.id is null then raise exception 'Generation not found'; end if;
  reserve_amount := case when g.billing_status = 'reserved' then g.estimated_credits else 0 end;
  charge_amount := case when p_billing_status = 'charged' then p_actual_credits else 0 end;

  update public.music_video_projects
    set reserved_credits = greatest(0, reserved_credits - reserve_amount),
        spent_credits = spent_credits + charge_amount
    where id = g.project_id;

  if g.approval_id is not null then
    update public.music_video_approvals
      set reserved_credits = greatest(0, reserved_credits - reserve_amount),
          consumed_credits = consumed_credits + charge_amount,
          status = case
            when consumed_credits + charge_amount >= max_credits then 'consumed'
            else status
          end
      where id = g.approval_id;
  end if;

  update public.music_video_generations
    set actual_credits = p_actual_credits,
        billing_status = p_billing_status
    where id = g.id
    returning * into g;
  return g;
end $$;

grant execute on function public.reserve_music_video_generation(uuid) to authenticated;
grant execute on function public.settle_music_video_generation(uuid, numeric, text) to authenticated;
