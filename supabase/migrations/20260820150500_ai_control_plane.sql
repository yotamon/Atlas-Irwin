-- Atlas AI Control Plane
-- Extends generation telemetry, adds owner-level routing/budget settings and
-- granular human-feedback events used for quality/cost learning.

alter table public.generation_runs
  add column task_type text,
  add column requested_model text,
  add column routed_provider text,
  add column gateway_generation_id text,
  add column video_project_id uuid references public.music_video_projects(id) on delete set null,
  add column parent_run_id uuid references public.generation_runs(id) on delete set null,
  add column attempt_index integer not null default 0 check (attempt_index >= 0),
  add column started_at timestamptz,
  add column completed_at timestamptz,
  add column latency_ms integer check (latency_ms is null or latency_ms >= 0),
  add column input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  add column output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  add column actual_cost_usd numeric(12,6) check (actual_cost_usd is null or actual_cost_usd >= 0),
  add column fallback_used boolean not null default false,
  add column fallback_count integer not null default 0 check (fallback_count >= 0),
  add column escalated boolean not null default false,
  add column escalation_reason text,
  add column quality_gate_passed boolean,
  add column quality_score numeric(5,4) check (quality_score is null or (quality_score >= 0 and quality_score <= 1)),
  add column quality_failures jsonb not null default '[]'::jsonb,
  add column user_outcome text check (user_outcome is null or user_outcome in ('accepted','edited','rejected','regenerated','published','unknown')),
  add column edit_distance_ratio numeric(5,4) check (edit_distance_ratio is null or (edit_distance_ratio >= 0 and edit_distance_ratio <= 1)),
  add column outcome_recorded_at timestamptz,
  add column metadata jsonb not null default '{}'::jsonb;

update public.generation_runs
set task_type = case purpose
  when 'campaign_plan' then 'marketing.campaign_plan'
  else purpose
end,
requested_model = model,
started_at = created_at,
completed_at = case when status in ('completed','failed') then updated_at else null end
where task_type is null;

create index generation_runs_owner_created_idx
  on public.generation_runs(owner_id, created_at desc);
create index generation_runs_task_created_idx
  on public.generation_runs(owner_id, task_type, created_at desc);
create index generation_runs_campaign_task_idx
  on public.generation_runs(campaign_id, task_type, created_at desc)
  where campaign_id is not null;
create index generation_runs_video_task_idx
  on public.generation_runs(video_project_id, task_type, created_at desc)
  where video_project_id is not null;
create index generation_runs_parent_idx
  on public.generation_runs(parent_run_id, attempt_index)
  where parent_run_id is not null;

create table public.ai_control_settings (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  routing_mode text not null default 'auto' check (routing_mode in ('auto','economy','balanced','premium')),
  monthly_budget_usd numeric(12,2) not null default 30 check (monthly_budget_usd >= 0),
  text_budget_usd numeric(12,2) not null default 10 check (text_budget_usd >= 0),
  image_budget_usd numeric(12,2) not null default 8 check (image_budget_usd >= 0),
  video_budget_usd numeric(12,2) not null default 12 check (video_budget_usd >= 0),
  hard_stop boolean not null default true,
  quality_escalation boolean not null default true,
  provider_sort text not null default 'cost' check (provider_sort in ('cost','ttft','tps')),
  task_overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_feedback_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  event_type text not null check (event_type in ('accepted','edited','rejected','regenerated','published','performance')),
  entity_type text,
  entity_id uuid,
  edit_distance_ratio numeric(5,4) check (edit_distance_ratio is null or (edit_distance_ratio >= 0 and edit_distance_ratio <= 1)),
  quality_signal numeric(5,4) check (quality_signal is null or (quality_signal >= 0 and quality_signal <= 1)),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ai_feedback_run_created_idx
  on public.ai_feedback_events(generation_run_id, created_at desc);
create index ai_feedback_owner_created_idx
  on public.ai_feedback_events(owner_id, created_at desc);

alter table public.ai_control_settings enable row level security;
alter table public.ai_feedback_events enable row level security;

create policy "admins select own ai_control_settings" on public.ai_control_settings
  for select to authenticated
  using (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins insert own ai_control_settings" on public.ai_control_settings
  for insert to authenticated
  with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins update own ai_control_settings" on public.ai_control_settings
  for update to authenticated
  using (owner_id=(select auth.uid()) and private.is_studio_admin())
  with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins delete own ai_control_settings" on public.ai_control_settings
  for delete to authenticated
  using (owner_id=(select auth.uid()) and private.is_studio_admin());

create policy "admins select own ai_feedback_events" on public.ai_feedback_events
  for select to authenticated
  using (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins insert own ai_feedback_events" on public.ai_feedback_events
  for insert to authenticated
  with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins update own ai_feedback_events" on public.ai_feedback_events
  for update to authenticated
  using (owner_id=(select auth.uid()) and private.is_studio_admin())
  with check (owner_id=(select auth.uid()) and private.is_studio_admin());
create policy "admins delete own ai_feedback_events" on public.ai_feedback_events
  for delete to authenticated
  using (owner_id=(select auth.uid()) and private.is_studio_admin());

create trigger set_ai_control_settings_updated_at
  before update on public.ai_control_settings
  for each row execute function private.set_updated_at();

grant select,insert,update,delete on public.ai_control_settings, public.ai_feedback_events to authenticated;
revoke all on public.ai_control_settings, public.ai_feedback_events from anon;
