-- Ensemblis Paid Growth: bounded, evidence-backed experiments rather than an ads dashboard.
-- Artist/release/Moment/creative/Smart Link lineage is canonical. Provider campaign objects are
-- external references. Spend, approval and observed outcomes are auditable and artist-scoped.

create table public.paid_growth_experiments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  release_id uuid not null references public.releases(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  moment_id uuid references public.moments(id) on delete set null,
  content_item_id uuid references public.content_items(id) on delete set null,
  smart_link_id uuid not null references public.smart_links(id) on delete restrict,
  smart_link_source_id uuid references public.smart_link_sources(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 160),
  hypothesis text not null check (char_length(btrim(hypothesis)) between 10 and 2000),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  evidence_strength text not null default 'preliminary' check (evidence_strength in ('preliminary','supported','strong')),
  provider text not null default 'meta' check (char_length(btrim(provider)) between 2 and 80),
  platform text not null check (platform in ('instagram','facebook','tiktok','youtube','other')),
  objective text not null check (objective in ('discovery','traffic','pre_save','streams')),
  audience jsonb not null default '{}'::jsonb check (jsonb_typeof(audience) = 'object'),
  geo_countries text[] not null default '{}'::text[],
  budget_ceiling_cents integer not null check (budget_ceiling_cents > 0),
  daily_budget_cents integer check (daily_budget_cents is null or daily_budget_cents > 0),
  spent_cents integer not null default 0 check (spent_cents >= 0 and spent_cents <= budget_ceiling_cents),
  minimum_sample integer not null default 100 check (minimum_sample >= 10),
  success_metric text not null check (success_metric in ('landing_views','outbound_clicks','pre_save_completions','cost_per_outbound_click','cost_per_pre_save_completion')),
  success_threshold numeric(14,4) not null check (success_threshold > 0),
  stop_conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(stop_conditions) = 'object'),
  state text not null default 'draft' check (state in ('draft','ready_for_approval','approved','launching','running','paused','evaluating','completed','stopped','error')),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected','revoked')),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  provider_experiment_id text,
  provider_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_metadata) = 'object'),
  starts_at timestamptz,
  ends_at timestamptz,
  verified_outcome boolean not null default false,
  result_summary text,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (daily_budget_cents is null or daily_budget_cents <= budget_ceiling_cents),
  check (approval_status <> 'approved' or approved_at is not null),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.paid_growth_observations (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.paid_growth_experiments(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  provider text not null,
  provider_reference text,
  impressions integer not null default 0 check (impressions >= 0),
  provider_clicks integer not null default 0 check (provider_clicks >= 0),
  spend_cents integer not null default 0 check (spend_cents >= 0),
  landing_views integer not null default 0 check (landing_views >= 0),
  outbound_clicks integer not null default 0 check (outbound_clicks >= 0),
  pre_save_completions integer not null default 0 check (pre_save_completions >= 0),
  verified boolean not null default false,
  verification_reference text,
  provider_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_snapshot) = 'object'),
  first_party_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(first_party_snapshot) = 'object'),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (not verified or verification_reference is not null)
);

create table public.paid_growth_operations (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.paid_growth_experiments(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  provider text not null,
  operation_type text not null check (operation_type in ('launch','pause','resume','stop','sync')),
  operation_key text not null,
  state text not null default 'started' check (state in ('started','completed','failed_safe','ambiguous','resolved')),
  request_snapshot jsonb not null default '{}'::jsonb,
  result_snapshot jsonb not null default '{}'::jsonb,
  provider_resource_id text,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, operation_key)
);

create table public.paid_growth_events (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid references public.paid_growth_experiments(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system' check (actor_type in ('artist','system','provider')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index paid_growth_artist_state_idx on public.paid_growth_experiments(owner_id, artist_id, state, updated_at desc);
create index paid_growth_release_idx on public.paid_growth_experiments(artist_id, release_id, created_at desc);
create index paid_growth_observations_experiment_idx on public.paid_growth_observations(experiment_id, observed_at desc);
create index paid_growth_operations_open_idx on public.paid_growth_operations(artist_id, experiment_id, operation_type, state) where state in ('started','ambiguous');
create index paid_growth_events_recent_idx on public.paid_growth_events(artist_id, created_at desc);

create trigger set_paid_growth_experiments_updated_at before update on public.paid_growth_experiments for each row execute function private.set_updated_at();

create or replace function private.validate_paid_growth_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_artist uuid;
  v_release uuid;
begin
  if tg_table_name = 'paid_growth_experiments' then
    select owner_id, artist_id, id into v_owner, v_artist, v_release from public.releases where id = new.release_id;
    if v_owner is null or v_owner <> new.owner_id or v_artist <> new.artist_id then raise exception 'Paid experiment must match its release artist'; end if;
    if new.campaign_id is not null and not exists (select 1 from public.campaigns c where c.id=new.campaign_id and c.owner_id=new.owner_id and c.artist_id=new.artist_id and (c.release_id is null or c.release_id=new.release_id)) then raise exception 'Paid experiment campaign lineage mismatch'; end if;
    if new.moment_id is not null and not exists (select 1 from public.moments m where m.id=new.moment_id and m.artist_id=new.artist_id and m.release_id=new.release_id and m.state='approved') then raise exception 'Paid experiment requires an approved Moment from the same release'; end if;
    if new.content_item_id is not null and not exists (select 1 from public.content_items i where i.id=new.content_item_id and i.owner_id=new.owner_id and i.artist_id=new.artist_id and i.release_id=new.release_id) then raise exception 'Paid experiment creative lineage mismatch'; end if;
    if not exists (select 1 from public.smart_links s where s.id=new.smart_link_id and s.owner_id=new.owner_id and s.artist_id=new.artist_id and s.release_id=new.release_id and s.is_active) then raise exception 'Paid experiment requires the active owned Smart Link for this release'; end if;
    if new.smart_link_source_id is not null and not exists (select 1 from public.smart_link_sources s where s.id=new.smart_link_source_id and s.smart_link_id=new.smart_link_id and s.owner_id=new.owner_id and s.artist_id=new.artist_id) then raise exception 'Paid experiment attribution source lineage mismatch'; end if;
    perform private.assert_operational_artist_owner(new.owner_id, new.artist_id);
    return new;
  end if;

  select e.owner_id, e.artist_id into v_owner, v_artist from public.paid_growth_experiments e where e.id=new.experiment_id;
  if v_owner is null or v_owner <> new.owner_id or v_artist <> new.artist_id then raise exception '% must match its paid experiment', tg_table_name; end if;
  perform private.assert_operational_artist_owner(new.owner_id, new.artist_id);
  return new;
end;
$$;
revoke all on function private.validate_paid_growth_scope() from public, anon, authenticated;

create trigger paid_growth_experiments_validate_scope before insert or update on public.paid_growth_experiments for each row execute function private.validate_paid_growth_scope();
create trigger paid_growth_observations_validate_scope before insert on public.paid_growth_observations for each row execute function private.validate_paid_growth_scope();
create trigger paid_growth_operations_validate_scope before insert or update on public.paid_growth_operations for each row execute function private.validate_paid_growth_scope();
create trigger paid_growth_events_validate_scope before insert on public.paid_growth_events for each row execute function private.validate_paid_growth_scope();

-- Spend is monotonic and can never cross the artist-approved experiment ceiling, even for service-role writes.
create or replace function private.guard_paid_growth_spend()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.spent_cents < old.spent_cents then raise exception 'Paid growth spend cannot move backwards'; end if;
  if new.spent_cents > new.budget_ceiling_cents then raise exception 'Paid growth hard budget ceiling exceeded'; end if;
  return new;
end;
$$;
revoke all on function private.guard_paid_growth_spend() from public, anon, authenticated;
create trigger paid_growth_spend_guard before update of spent_cents,budget_ceiling_cents on public.paid_growth_experiments for each row execute function private.guard_paid_growth_spend();

-- Append-only evidence/audit rows.
create or replace function private.prevent_paid_growth_evidence_mutation()
returns trigger language plpgsql set search_path = '' as $$ begin raise exception '% is append-only', tg_table_name; end $$;
revoke all on function private.prevent_paid_growth_evidence_mutation() from public, anon, authenticated;
create trigger paid_growth_observations_immutable before update or delete on public.paid_growth_observations for each row execute function private.prevent_paid_growth_evidence_mutation();
create trigger paid_growth_events_immutable before update or delete on public.paid_growth_events for each row execute function private.prevent_paid_growth_evidence_mutation();

-- Atomic provider-observation ingestion also clamps canonical spend at the approved ceiling.
create or replace function public.record_paid_growth_observation(
  p_experiment_id uuid,
  p_provider_reference text,
  p_impressions integer,
  p_provider_clicks integer,
  p_spend_cents integer,
  p_landing_views integer,
  p_outbound_clicks integer,
  p_pre_save_completions integer,
  p_verified boolean,
  p_verification_reference text,
  p_provider_snapshot jsonb,
  p_first_party_snapshot jsonb,
  p_observed_at timestamptz
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_artist uuid;
  v_ceiling integer;
  v_id uuid;
begin
  select owner_id, artist_id, budget_ceiling_cents into v_owner, v_artist, v_ceiling
  from public.paid_growth_experiments
  where id=p_experiment_id and owner_id=(select auth.uid())
  for update;
  if v_owner is null or not private.can_access_artist(v_artist) then raise exception 'Paid experiment not found'; end if;
  if p_spend_cents < 0 or p_spend_cents > v_ceiling then raise exception 'Observed spend exceeds the approved experiment ceiling'; end if;
  if p_verified and nullif(btrim(coalesce(p_verification_reference,'')),'') is null then raise exception 'Verified observations require a verification reference'; end if;

  insert into public.paid_growth_observations(
    experiment_id,owner_id,artist_id,provider,provider_reference,impressions,provider_clicks,spend_cents,
    landing_views,outbound_clicks,pre_save_completions,verified,verification_reference,provider_snapshot,first_party_snapshot,observed_at
  )
  select id,owner_id,artist_id,provider,p_provider_reference,greatest(p_impressions,0),greatest(p_provider_clicks,0),p_spend_cents,
    greatest(p_landing_views,0),greatest(p_outbound_clicks,0),greatest(p_pre_save_completions,0),p_verified,p_verification_reference,
    coalesce(p_provider_snapshot,'{}'::jsonb),coalesce(p_first_party_snapshot,'{}'::jsonb),p_observed_at
  from public.paid_growth_experiments where id=p_experiment_id
  returning id into v_id;

  update public.paid_growth_experiments set spent_cents=greatest(spent_cents,p_spend_cents) where id=p_experiment_id;
  return v_id;
end;
$$;
revoke all on function public.record_paid_growth_observation(uuid,text,integer,integer,integer,integer,integer,integer,boolean,text,jsonb,jsonb,timestamptz) from public, anon;
grant execute on function public.record_paid_growth_observation(uuid,text,integer,integer,integer,integer,integer,integer,boolean,text,jsonb,jsonb,timestamptz) to authenticated;

alter table public.paid_growth_experiments enable row level security;
alter table public.paid_growth_observations enable row level security;
alter table public.paid_growth_operations enable row level security;
alter table public.paid_growth_events enable row level security;

create policy paid_growth_experiments_select on public.paid_growth_experiments for select to authenticated using (owner_id=auth.uid() and private.can_access_artist(artist_id));
create policy paid_growth_experiments_insert on public.paid_growth_experiments for insert to authenticated with check (owner_id=auth.uid() and private.can_access_artist(artist_id));
create policy paid_growth_experiments_update on public.paid_growth_experiments for update to authenticated using (owner_id=auth.uid() and private.can_access_artist(artist_id)) with check (owner_id=auth.uid() and private.can_access_artist(artist_id));
create policy paid_growth_observations_select on public.paid_growth_observations for select to authenticated using (owner_id=auth.uid() and private.can_access_artist(artist_id));
create policy paid_growth_operations_select on public.paid_growth_operations for select to authenticated using (owner_id=auth.uid() and private.can_access_artist(artist_id));
create policy paid_growth_events_select on public.paid_growth_events for select to authenticated using (owner_id=auth.uid() and private.can_access_artist(artist_id));

revoke all on public.paid_growth_experiments, public.paid_growth_observations, public.paid_growth_operations, public.paid_growth_events from anon, authenticated;
grant select,insert,update on public.paid_growth_experiments to authenticated;
grant select on public.paid_growth_observations, public.paid_growth_operations, public.paid_growth_events to authenticated;

revoke all on public.paid_growth_experiments, public.paid_growth_observations, public.paid_growth_operations, public.paid_growth_events from service_role;
grant all on public.paid_growth_experiments, public.paid_growth_observations, public.paid_growth_operations, public.paid_growth_events to service_role;

comment on table public.paid_growth_experiments is 'Artist-approved bounded paid experiments with canonical music, creative and first-party attribution lineage.';
comment on column public.paid_growth_experiments.budget_ceiling_cents is 'Hard experiment spend ceiling. Provider adapters must never configure or report spend beyond this value.';
comment on table public.paid_growth_observations is 'Append-only normalized provider + first-party observations. Only verified outcomes may feed durable learning.';
