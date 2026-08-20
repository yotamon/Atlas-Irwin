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
create unique index ai_feedback_unique_entity_action_idx
  on public.ai_feedback_events(generation_run_id,event_type,entity_type,entity_id)
  where entity_id is not null and event_type in ('accepted','rejected','published','regenerated');

-- Feedback is recorded at the data boundary so future UI refactors cannot silently
-- disconnect Atlas learning from the user's actual choices.
create or replace function private.insert_ai_feedback(
  p_owner_id uuid,
  p_run_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_edit_ratio numeric default null,
  p_quality_signal numeric default null,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_run_id is null then return; end if;
  insert into public.ai_feedback_events(
    owner_id,generation_run_id,event_type,entity_type,entity_id,
    edit_distance_ratio,quality_signal,metadata
  ) values (
    p_owner_id,p_run_id,p_event_type,p_entity_type,p_entity_id,
    p_edit_ratio,p_quality_signal,coalesce(p_metadata,'{}'::jsonb)
  ) on conflict do nothing;

  if p_event_type in ('accepted','edited','rejected','regenerated','published') then
    update public.generation_runs set
      user_outcome = p_event_type,
      edit_distance_ratio = coalesce(p_edit_ratio, edit_distance_ratio),
      outcome_recorded_at = now()
    where id = p_run_id and owner_id = p_owner_id;
  end if;
end;
$$;

create or replace function private.ai_feedback_variant_status()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.generation_run_id is null or new.approval_status is not distinct from old.approval_status then
    return new;
  end if;
  if new.approval_status = 'approved' then
    perform private.insert_ai_feedback(new.owner_id,new.generation_run_id,'accepted','content_variant',new.id,null,1,'{}'::jsonb);
  elsif new.approval_status = 'rejected' then
    perform private.insert_ai_feedback(new.owner_id,new.generation_run_id,'rejected','content_variant',new.id,null,0,'{}'::jsonb);
  end if;
  return new;
end;
$$;
create trigger record_ai_variant_feedback
  after update of approval_status on public.content_variants
  for each row execute function private.ai_feedback_variant_status();

create or replace function private.ai_feedback_content_edit()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare
  changed_count integer := 0;
  source_count integer := 0;
  ratio numeric;
begin
  if new.generated_from_run_id is null then return new; end if;
  source_count :=
    (case when old.hook_text is not null then 1 else 0 end) +
    (case when old.caption is not null then 1 else 0 end) +
    (case when old.cta is not null then 1 else 0 end) +
    (case when old.visual_prompt is not null then 1 else 0 end) +
    (case when old.production_notes is not null then 1 else 0 end);
  changed_count :=
    (case when new.hook_text is distinct from old.hook_text then 1 else 0 end) +
    (case when new.caption is distinct from old.caption then 1 else 0 end) +
    (case when new.cta is distinct from old.cta then 1 else 0 end) +
    (case when new.visual_prompt is distinct from old.visual_prompt then 1 else 0 end) +
    (case when new.production_notes is distinct from old.production_notes then 1 else 0 end);
  if changed_count > 0 then
    ratio := least(1::numeric, changed_count::numeric / greatest(1, source_count)::numeric);
    perform private.insert_ai_feedback(
      new.owner_id,new.generated_from_run_id,'edited','content_item',new.id,
      ratio,greatest(0::numeric,1-ratio),jsonb_build_object('changed_fields',changed_count)
    );
  end if;
  if new.published_at is not null and old.published_at is null then
    perform private.insert_ai_feedback(new.owner_id,new.generated_from_run_id,'published','content_item',new.id,null,1,'{}'::jsonb);
  end if;
  return new;
end;
$$;
create trigger record_ai_content_feedback
  after update on public.content_items
  for each row execute function private.ai_feedback_content_edit();

create or replace function private.ai_feedback_video_concept_selected()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare run_id uuid;
begin
  if new.status = 'selected' and old.status is distinct from new.status then
    select id into run_id from public.generation_runs
      where owner_id=new.owner_id and video_project_id=new.project_id
        and task_type='video.concepts' and status='completed'
      order by created_at desc limit 1;
    perform private.insert_ai_feedback(new.owner_id,run_id,'accepted','music_video_concept',new.id,null,1,'{}'::jsonb);
  end if;
  return new;
end;
$$;
create trigger record_ai_video_concept_feedback
  after update of status on public.music_video_concepts
  for each row execute function private.ai_feedback_video_concept_selected();

create or replace function private.ai_feedback_video_plan_approved()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare run_id uuid;
begin
  if new.approval_type = 'production_plan' and new.status = 'active' then
    select id into run_id from public.generation_runs
      where owner_id=new.owner_id and video_project_id=new.project_id
        and task_type='video.production_plan' and status='completed'
      order by created_at desc limit 1;
    perform private.insert_ai_feedback(new.owner_id,run_id,'accepted','music_video_approval',new.id,null,1,'{}'::jsonb);
  end if;
  return new;
end;
$$;
create trigger record_ai_video_plan_feedback
  after insert on public.music_video_approvals
  for each row execute function private.ai_feedback_video_plan_approved();

create or replace function private.ai_feedback_regenerated_run()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare previous_id uuid;
begin
  if new.status <> 'completed' or old.status = 'completed' or new.attempt_index <> 0 then return new; end if;
  if new.video_project_id is not null then
    select id into previous_id from public.generation_runs
      where owner_id=new.owner_id and video_project_id=new.video_project_id
        and task_type=new.task_type and id<>new.id and attempt_index=0 and status='completed'
      order by created_at desc limit 1;
    perform private.insert_ai_feedback(new.owner_id,previous_id,'regenerated','generation_run',previous_id,null,0.1,jsonb_build_object('replacement_run_id',new.id));
  end if;
  return new;
end;
$$;
create trigger record_ai_regeneration_feedback
  after update of status on public.generation_runs
  for each row execute function private.ai_feedback_regenerated_run();

create or replace function private.ai_feedback_campaign_run_linked()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare previous_id uuid;
begin
  if new.campaign_id is not null and old.campaign_id is null and new.task_type='marketing.campaign_plan' then
    select id into previous_id from public.generation_runs
      where owner_id=new.owner_id and campaign_id=new.campaign_id and task_type=new.task_type
        and id<>new.id and attempt_index=0 and status='completed'
      order by created_at desc limit 1;
    perform private.insert_ai_feedback(new.owner_id,previous_id,'regenerated','generation_run',previous_id,null,0.1,jsonb_build_object('replacement_run_id',new.id));
  end if;
  return new;
end;
$$;
create trigger record_ai_campaign_regeneration_feedback
  after update of campaign_id on public.generation_runs
  for each row execute function private.ai_feedback_campaign_run_linked();

create or replace function private.ai_feedback_metric_snapshot()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare run_id uuid;
begin
  if new.content_variant_id is not null then
    select generation_run_id into run_id from public.content_variants where id=new.content_variant_id;
  end if;
  if run_id is null and new.content_item_id is not null then
    select generated_from_run_id into run_id from public.content_items where id=new.content_item_id;
  end if;
  if run_id is not null then
    perform private.insert_ai_feedback(
      new.owner_id,run_id,'performance','metric_snapshot',new.id,null,null,
      jsonb_build_object('platform',new.platform,'date',new.date,'reach',new.reach,'views',new.views,'saves',new.saves,'follows',new.follows,'link_clicks',new.link_clicks,'streams',new.streams)
    );
  end if;
  return new;
end;
$$;
create trigger record_ai_performance_feedback
  after insert on public.metric_snapshots
  for each row execute function private.ai_feedback_metric_snapshot();

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
