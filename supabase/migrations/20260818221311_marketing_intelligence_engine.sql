-- Atlas Marketing Intelligence Engine
-- Adds first-class campaigns, experiments, variants, approvals, attribution,
-- orchestration jobs, structured learnings, and outreach sequences.

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  release_id uuid references public.releases(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft','planned','active','paused','completed','archived')),
  mode text not null default 'assisted' check (mode in ('suggest','assisted','autopilot')),
  objective text not null default 'Streams',
  primary_kpi text not null default 'link_click_rate',
  secondary_kpis text[] not null default '{}',
  audience_segments jsonb not null default '[]'::jsonb,
  strategy jsonb not null default '{}'::jsonb,
  release_anchor_date date,
  start_date date,
  end_date date,
  budget_cents integer not null default 0 check (budget_cents >= 0),
  spent_cents integer not null default 0 check (spent_cents >= 0),
  learning_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaign_phases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  code text not null,
  name text not null,
  objective text not null,
  relative_start_days integer not null default 0,
  relative_end_days integer not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'planned' check (status in ('planned','active','completed','skipped')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, code)
);

create table public.campaign_experiments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  phase_id uuid references public.campaign_phases(id) on delete set null,
  title text not null,
  hypothesis text not null,
  goal text not null,
  primary_metric text not null,
  status text not null default 'planned' check (status in ('planned','running','evaluating','winner_found','inconclusive','stopped')),
  minimum_sample integer not null default 250 check (minimum_sample >= 0),
  minimum_lift numeric not null default 0.15 check (minimum_lift >= 0),
  evaluation_window_hours integer not null default 72 check (evaluation_window_hours > 0),
  winner_variant_id uuid,
  result_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  release_id uuid references public.releases(id) on delete set null,
  purpose text not null,
  provider text not null,
  model text not null,
  prompt_version text not null default 'marketing-v1',
  input_context jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  status text not null default 'completed' check (status in ('queued','running','completed','failed')),
  estimated_cost_usd numeric(12,6),
  provider_request_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_variants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  experiment_id uuid references public.campaign_experiments(id) on delete set null,
  generation_run_id uuid references public.generation_runs(id) on delete set null,
  label text not null,
  hypothesis text,
  hook_text text,
  caption text,
  cta text,
  visual_prompt text,
  production_notes text,
  asset_url text,
  status text not null default 'draft' check (status in ('draft','ready','approved','scheduled','published','rejected','archived')),
  approval_status text not null default 'pending' check (approval_status in ('not_required','pending','approved','rejected')),
  is_control boolean not null default false,
  scheduled_at timestamptz,
  published_at timestamptz,
  external_post_id text,
  attribution_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(content_item_id, label)
);

alter table public.campaign_experiments
  add constraint campaign_experiments_winner_variant_fk
  foreign key (winner_variant_id) references public.content_variants(id) on delete set null;

alter table public.content_items
  add column campaign_id uuid references public.campaigns(id) on delete set null,
  add column phase_id uuid references public.campaign_phases(id) on delete set null,
  add column experiment_id uuid references public.campaign_experiments(id) on delete set null,
  add column approval_status text not null default 'not_required' check (approval_status in ('not_required','pending','approved','rejected')),
  add column source text not null default 'manual' check (source in ('manual','planner','ai','automation')),
  add column generated_from_run_id uuid references public.generation_runs(id) on delete set null,
  add column content_angle text,
  add column audience_segment text;

create table public.publication_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  content_item_id uuid references public.content_items(id) on delete cascade,
  content_variant_id uuid references public.content_variants(id) on delete cascade,
  platform text not null,
  adapter text not null,
  status text not null default 'draft' check (status in ('draft','awaiting_approval','approved','scheduled','publishing','published','failed','cancelled')),
  requires_approval boolean not null default true,
  approval_status text not null default 'pending' check (approval_status in ('not_required','pending','approved','rejected')),
  scheduled_at timestamptz,
  published_at timestamptz,
  external_post_id text,
  external_url text,
  request_payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  last_error text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.attribution_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  content_item_id uuid references public.content_items(id) on delete set null,
  content_variant_id uuid references public.content_variants(id) on delete set null,
  code text not null,
  platform text,
  destination_url text not null,
  label text,
  is_active boolean not null default true,
  click_count bigint not null default 0 check (click_count >= 0),
  unique_click_count bigint not null default 0 check (unique_click_count >= 0),
  last_clicked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(code)
);

create table public.attribution_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  attribution_link_id uuid not null references public.attribution_links(id) on delete cascade,
  event_type text not null default 'click' check (event_type in ('click','landing','conversion')),
  visitor_hash text,
  referrer text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  source_event_id uuid references public.marketing_events(id) on delete set null,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','awaiting_approval','running','completed','failed','cancelled')),
  requires_approval boolean not null default false,
  approval_status text not null default 'not_required' check (approval_status in ('not_required','pending','approved','rejected')),
  run_after timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  locked_at timestamptz,
  completed_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  error text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_learnings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  release_id uuid references public.releases(id) on delete set null,
  experiment_id uuid references public.campaign_experiments(id) on delete set null,
  scope text not null default 'campaign' check (scope in ('brand','platform','audience','campaign','release','experiment','content')),
  finding text not null,
  evidence jsonb not null default '{}'::jsonb,
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','superseded')),
  applies_to jsonb not null default '{}'::jsonb,
  source text not null default 'analysis' check (source in ('analysis','manual','experiment','import')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.outreach_sequences (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft','active','paused','completed','archived')),
  audience_filter jsonb not null default '{}'::jsonb,
  stop_on_reply boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.outreach_sequence_steps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  sequence_id uuid not null references public.outreach_sequences(id) on delete cascade,
  step_order integer not null check (step_order >= 0),
  delay_days integer not null default 0 check (delay_days >= 0),
  channel text not null,
  subject_template text,
  message_template text not null,
  objective text,
  requires_approval boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sequence_id, step_order)
);

create table public.outreach_enrollments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  sequence_id uuid not null references public.outreach_sequences(id) on delete cascade,
  contact_id uuid not null references public.outreach_contacts(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  status text not null default 'active' check (status in ('active','paused','completed','stopped','failed')),
  next_step_order integer not null default 0 check (next_step_order >= 0),
  next_run_at timestamptz,
  stopped_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sequence_id, contact_id)
);

alter table public.outreach_messages
  add column sequence_enrollment_id uuid references public.outreach_enrollments(id) on delete set null,
  add column sequence_step_id uuid references public.outreach_sequence_steps(id) on delete set null,
  add column campaign_id uuid references public.campaigns(id) on delete set null;

alter table public.metric_snapshots
  add column campaign_id uuid references public.campaigns(id) on delete set null,
  add column experiment_id uuid references public.campaign_experiments(id) on delete set null,
  add column content_variant_id uuid references public.content_variants(id) on delete set null,
  add column source text not null default 'manual',
  add column external_object_id text,
  add column captured_at timestamptz not null default now();

create index campaigns_release_status_idx on public.campaigns(owner_id, release_id, status);
create index campaign_phases_active_idx on public.campaign_phases(campaign_id, status, sort_order);
create index campaign_experiments_status_idx on public.campaign_experiments(campaign_id, status);
create index content_campaign_status_idx on public.content_items(campaign_id, status, scheduled_at);
create index content_variants_experiment_idx on public.content_variants(experiment_id, status);
create index publication_jobs_due_idx on public.publication_jobs(owner_id, status, scheduled_at);
create unique index publication_jobs_idempotency_idx on public.publication_jobs(owner_id, idempotency_key) where idempotency_key is not null;
create index attribution_links_campaign_idx on public.attribution_links(campaign_id, content_item_id, content_variant_id);
create index attribution_events_link_time_idx on public.attribution_events(attribution_link_id, occurred_at desc);
create index marketing_events_unprocessed_idx on public.marketing_events(owner_id, occurred_at) where processed_at is null;
create index automation_jobs_due_idx on public.automation_jobs(owner_id, status, run_after) where status in ('queued','awaiting_approval');
create unique index automation_jobs_idempotency_idx on public.automation_jobs(owner_id, idempotency_key) where idempotency_key is not null;
create index marketing_learnings_scope_idx on public.marketing_learnings(owner_id, status, scope, created_at desc);
create index outreach_enrollments_due_idx on public.outreach_enrollments(owner_id, status, next_run_at) where status = 'active';
create index metrics_campaign_idx on public.metric_snapshots(campaign_id, date desc);
create index metrics_variant_idx on public.metric_snapshots(content_variant_id, date desc);

-- All Marketing Engine records remain private Studio data. Public attribution redirects
-- are handled server-side with the service role rather than opening RLS to anon users.
do $$
declare t text;
begin
  foreach t in array array[
    'campaigns','campaign_phases','campaign_experiments','generation_runs',
    'content_variants','publication_jobs','attribution_links','attribution_events',
    'marketing_events','automation_jobs','marketing_learnings','outreach_sequences',
    'outreach_sequence_steps','outreach_enrollments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "admins select own %1$s" on public.%1$I for select to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins insert own %1$s" on public.%1$I for insert to authenticated with check (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins update own %1$s" on public.%1$I for update to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin()) with check (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins delete own %1$s" on public.%1$I for delete to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
    execute format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

grant select,insert,update,delete on all tables in schema public to authenticated;
revoke all on public.campaigns, public.campaign_phases, public.campaign_experiments,
  public.generation_runs, public.content_variants, public.publication_jobs,
  public.attribution_links, public.attribution_events, public.marketing_events,
  public.automation_jobs, public.marketing_learnings, public.outreach_sequences,
  public.outreach_sequence_steps, public.outreach_enrollments from anon;
