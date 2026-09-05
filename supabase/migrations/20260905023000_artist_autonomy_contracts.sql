-- Ensemblis autonomy contracts v1
-- Artist/domain-scoped authority is an additional gate over existing approval, spend,
-- provider and external-effect safety. A Run contract never bypasses those systems.

create table if not exists public.artist_autonomy_contracts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  domain text not null check (domain in (
    'analytics_reconciliation',
    'music_analysis',
    'moment_curation',
    'creative_ideation',
    'creative_generation',
    'social_scheduling',
    'social_publishing',
    'audience_replies',
    'paid_growth',
    'outreach',
    'sites',
    'distribution'
  )),
  mode text not null check (mode in ('assist', 'prepare', 'run')),
  enabled boolean not null default true,
  max_single_spend_usd numeric(12,4) null check (max_single_spend_usd is null or max_single_spend_usd >= 0),
  max_total_spend_usd numeric(12,4) null check (max_total_spend_usd is null or max_total_spend_usd >= 0),
  allowed_providers text[] not null default '{}'::text[],
  allowed_platforms text[] not null default '{}'::text[],
  expires_at timestamptz null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, artist_id, domain),
  check (
    max_total_spend_usd is null
    or max_single_spend_usd is null
    or max_single_spend_usd <= max_total_spend_usd
  )
);

create index if not exists artist_autonomy_contracts_artist_idx
  on public.artist_autonomy_contracts (owner_id, artist_id, enabled, domain);
create index if not exists artist_autonomy_contracts_expiry_idx
  on public.artist_autonomy_contracts (expires_at)
  where enabled and expires_at is not null;

create table if not exists public.autonomy_decision_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  domain text not null,
  contract_id uuid null references public.artist_autonomy_contracts(id) on delete set null,
  requested_action text not null check (char_length(requested_action) between 1 and 160),
  resolved_behavior text not null check (resolved_behavior in ('run', 'prepare', 'ask')),
  reason text not null check (char_length(reason) between 1 and 1000),
  contract_snapshot jsonb not null default '{}'::jsonb,
  effect_snapshot jsonb not null default '{}'::jsonb,
  execution_id text null check (execution_id is null or char_length(execution_id) <= 240),
  created_at timestamptz not null default now()
);

create index if not exists autonomy_decision_events_artist_recent_idx
  on public.autonomy_decision_events (owner_id, artist_id, created_at desc);
create index if not exists autonomy_decision_events_execution_idx
  on public.autonomy_decision_events (execution_id)
  where execution_id is not null;

create trigger set_artist_autonomy_contracts_updated_at
  before update on public.artist_autonomy_contracts
  for each row execute function private.set_updated_at();

alter table public.artist_autonomy_contracts enable row level security;
alter table public.autonomy_decision_events enable row level security;

revoke all on table public.artist_autonomy_contracts from anon, authenticated;
revoke all on table public.autonomy_decision_events from anon, authenticated;
grant select, insert, update, delete on table public.artist_autonomy_contracts to authenticated;
grant select on table public.autonomy_decision_events to authenticated;

create policy artist_autonomy_contracts_select
  on public.artist_autonomy_contracts
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    and private.can_access_artist(artist_id)
  );

create policy artist_autonomy_contracts_insert
  on public.artist_autonomy_contracts
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and private.can_access_artist(artist_id)
    and (created_by is null or created_by = auth.uid())
  );

create policy artist_autonomy_contracts_update
  on public.artist_autonomy_contracts
  for update
  to authenticated
  using (
    owner_id = auth.uid()
    and private.can_access_artist(artist_id)
  )
  with check (
    owner_id = auth.uid()
    and private.can_access_artist(artist_id)
  );

create policy artist_autonomy_contracts_delete
  on public.artist_autonomy_contracts
  for delete
  to authenticated
  using (
    owner_id = auth.uid()
    and private.can_access_artist(artist_id)
  );

create policy autonomy_decision_events_select
  on public.autonomy_decision_events
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    and private.can_access_artist(artist_id)
  );

revoke all on table public.artist_autonomy_contracts from service_role;
revoke all on table public.autonomy_decision_events from service_role;
grant all on table public.artist_autonomy_contracts to service_role;
grant select, insert on table public.autonomy_decision_events to service_role;

comment on table public.artist_autonomy_contracts is
  'Artist/domain-scoped Assist/Prepare/Run authority. This is an additional gate and never bypasses spend, provider, publication, distribution or sensitive-action safeguards.';
comment on table public.autonomy_decision_events is
  'Append-only snapshots of resolved autonomy decisions at execution boundaries. Authenticated artists can inspect them; only trusted server workflows write them.';
