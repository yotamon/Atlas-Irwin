create table public.audience_interactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'youtube', 'tiktok')),
  interaction_type text not null check (interaction_type in ('comment', 'reply', 'message', 'mention')),
  external_interaction_id text not null,
  external_parent_id text,
  external_post_id text,
  author_name text,
  author_handle text,
  body text not null default '',
  occurred_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'needs_reply', 'drafted', 'approved', 'replied', 'ignored')),
  suggested_reply text,
  reply_confidence numeric(5,4),
  auto_reply_eligible boolean not null default false,
  sentiment text check (sentiment is null or sentiment in ('positive', 'neutral', 'negative', 'question')),
  raw jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, platform, external_interaction_id)
);

create table public.marketing_opportunities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('trend', 'content_angle', 'collaboration', 'playlist', 'event', 'breakout', 'risk')),
  source text not null,
  external_key text not null,
  title text not null,
  summary text not null default '',
  url text,
  score numeric(6,3) not null default 0,
  urgency numeric(6,3) not null default 0,
  expires_at timestamptz,
  evidence jsonb not null default '{}',
  recommended_action text,
  status text not null default 'new' check (status in ('new', 'accepted', 'dismissed', 'converted', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, source, external_key)
);

create table public.next_best_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  action_type text not null,
  title text not null,
  rationale text not null default '',
  score numeric(6,3) not null default 0,
  source_type text,
  source_id uuid,
  payload jsonb not null default '{}',
  idempotency_key text not null,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'executing', 'completed', 'dismissed', 'expired')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, idempotency_key)
);

-- Service-only runtime credentials store hashes only. The corresponding raw cron
-- token is generated and encrypted in Supabase Vault by the production provisioning SQL.
create table public.automation_runtime_secrets (
  key text primary key,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index audience_interactions_owner_status_occurred_idx
  on public.audience_interactions(owner_id, status, occurred_at desc);
create index audience_interactions_post_idx
  on public.audience_interactions(owner_id, platform, external_post_id);
create index marketing_opportunities_owner_status_score_idx
  on public.marketing_opportunities(owner_id, status, score desc, urgency desc);
create index next_best_actions_owner_status_score_idx
  on public.next_best_actions(owner_id, status, score desc, created_at desc);

alter table public.audience_interactions enable row level security;
alter table public.marketing_opportunities enable row level security;
alter table public.next_best_actions enable row level security;
alter table public.automation_runtime_secrets enable row level security;

create policy "admins manage own audience interactions"
  on public.audience_interactions for all to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins manage own marketing opportunities"
  on public.marketing_opportunities for all to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());
create policy "admins manage own next best actions"
  on public.next_best_actions for all to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());

create trigger set_audience_interactions_updated_at
  before update on public.audience_interactions
  for each row execute function private.set_updated_at();
create trigger set_marketing_opportunities_updated_at
  before update on public.marketing_opportunities
  for each row execute function private.set_updated_at();
create trigger set_next_best_actions_updated_at
  before update on public.next_best_actions
  for each row execute function private.set_updated_at();
create trigger set_automation_runtime_secrets_updated_at
  before update on public.automation_runtime_secrets
  for each row execute function private.set_updated_at();

grant select, insert, update, delete on public.audience_interactions to authenticated;
grant select, insert, update, delete on public.marketing_opportunities to authenticated;
grant select, insert, update, delete on public.next_best_actions to authenticated;
revoke all on public.automation_runtime_secrets from anon, authenticated;
grant select, insert, update, delete on public.automation_runtime_secrets to service_role;
