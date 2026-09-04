-- Ensemblis Distribution: provider-neutral release delivery, readiness and operations.
-- Ensemblis is canonical. Provider payloads/statuses are snapshots or external references only.

create table public.distribution_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'revelator',
  provider_account_id text,
  status text not null default 'setup_required' check (status in ('setup_required','pending_verification','active','restricted','suspended')),
  legal_name text,
  country_code text,
  agreement_accepted_at timestamptz,
  rights_terms_accepted_at timestamptz,
  kyc_status text not null default 'not_started' check (kyc_status in ('not_started','pending','verified','failed')),
  payout_status text not null default 'not_started' check (payout_status in ('not_started','pending','ready','restricted')),
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider)
);

create table public.distribution_artist_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_name text not null,
  platform text not null,
  external_artist_id text,
  external_url text,
  status text not null default 'unconfirmed' check (status in ('unconfirmed','suggested','confirmed','create_new','conflict')),
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  provider_metadata jsonb not null default '{}'::jsonb,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, artist_name, platform)
);

create table public.release_distribution_configs (
  release_id uuid primary key references public.releases(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'revelator',
  provider_release_id text,
  state text not null default 'draft' check (state in ('draft','needs_attention','ready','submitted','under_review','approved','delivering','delivered','partially_live','live','rejected','update_pending','takedown_pending','taken_down','error')),
  destinations jsonb not null default '[]'::jsonb,
  territories jsonb not null default '{"mode":"worldwide","countries":[]}'::jsonb,
  rights jsonb not null default '{}'::jsonb,
  ai_provenance jsonb not null default '{}'::jsonb,
  provider_metadata jsonb not null default '{}'::jsonb,
  readiness_score integer not null default 0 check (readiness_score between 0 and 100),
  last_validated_at timestamptz,
  submitted_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.distribution_submissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  release_id uuid not null references public.releases(id) on delete cascade,
  version integer not null,
  provider text not null,
  provider_release_id text not null,
  state text not null default 'submitted' check (state in ('submitted','under_review','approved','delivering','delivered','partially_live','live','rejected','update_pending','takedown_pending','taken_down','error')),
  metadata_snapshot jsonb not null,
  rights_snapshot jsonb not null,
  ai_provenance_snapshot jsonb not null,
  asset_snapshot jsonb not null,
  destination_snapshot jsonb not null,
  provider_snapshot jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(release_id, version)
);

create table public.distribution_deliveries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  release_id uuid not null references public.releases(id) on delete cascade,
  submission_id uuid references public.distribution_submissions(id) on delete set null,
  provider text not null,
  store_id text not null,
  store_name text not null,
  state text not null default 'submitted' check (state in ('submitted','under_review','approved','delivering','delivered','partially_live','live','rejected','update_pending','takedown_pending','taken_down','error')),
  provider_status text,
  store_url text,
  raw_status jsonb not null default '{}'::jsonb,
  delivered_at timestamptz,
  live_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(release_id, provider, store_id)
);

create table public.distribution_validation_issues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  release_id uuid not null references public.releases(id) on delete cascade,
  submission_id uuid references public.distribution_submissions(id) on delete cascade,
  fingerprint text not null,
  code text not null,
  title text not null,
  detail text not null,
  severity text not null check (severity in ('error','warning','info')),
  source text not null check (source in ('ensemblis','provider','store')),
  object_type text,
  object_id text,
  store_id text,
  status text not null default 'open' check (status in ('open','acknowledged','resolved','ignored')),
  raw_issue jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(release_id, fingerprint)
);

create table public.distribution_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  release_id uuid references public.releases(id) on delete cascade,
  submission_id uuid references public.distribution_submissions(id) on delete set null,
  event_type text not null,
  actor_type text not null default 'system' check (actor_type in ('artist','operator','system','provider')),
  provider text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index distribution_accounts_owner_idx on public.distribution_accounts(owner_id, status);
create index distribution_profiles_owner_idx on public.distribution_artist_profiles(owner_id, platform, status);
create index release_distribution_state_idx on public.release_distribution_configs(owner_id, state);
create index distribution_submissions_release_idx on public.distribution_submissions(release_id, version desc);
create index distribution_deliveries_release_state_idx on public.distribution_deliveries(release_id, state);
create index distribution_issues_owner_open_idx on public.distribution_validation_issues(owner_id, status, severity) where status in ('open','acknowledged');
create index distribution_events_release_idx on public.distribution_events(release_id, created_at desc);

-- Submission snapshots are evidence of what was actually approved/submitted. They are append-only.
create or replace function private.prevent_distribution_submission_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'distribution_submissions are immutable; create a new version instead';
end;
$$;
revoke all on function private.prevent_distribution_submission_mutation() from public, anon, authenticated;
create trigger prevent_distribution_submission_update before update on public.distribution_submissions for each row execute function private.prevent_distribution_submission_mutation();
create trigger prevent_distribution_submission_delete before delete on public.distribution_submissions for each row execute function private.prevent_distribution_submission_mutation();

-- Atomic version allocation prevents two submit clicks from creating the same release version.
create or replace function public.create_distribution_submission(
  p_release_id uuid,
  p_provider text,
  p_provider_release_id text,
  p_metadata_snapshot jsonb,
  p_rights_snapshot jsonb,
  p_ai_provenance_snapshot jsonb,
  p_asset_snapshot jsonb,
  p_destination_snapshot jsonb,
  p_provider_snapshot jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_version integer;
  v_id uuid;
begin
  select owner_id into v_owner from public.releases where id = p_release_id and owner_id = (select auth.uid());
  if v_owner is null or not private.is_studio_admin() then raise exception 'Release not found or unauthorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_release_id::text, 0));
  select coalesce(max(version),0)+1 into v_version from public.distribution_submissions where release_id = p_release_id;
  insert into public.distribution_submissions(owner_id,release_id,version,provider,provider_release_id,metadata_snapshot,rights_snapshot,ai_provenance_snapshot,asset_snapshot,destination_snapshot,provider_snapshot)
  values(v_owner,p_release_id,v_version,p_provider,p_provider_release_id,p_metadata_snapshot,p_rights_snapshot,p_ai_provenance_snapshot,p_asset_snapshot,p_destination_snapshot,p_provider_snapshot)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_distribution_submission(uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.create_distribution_submission(uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

-- Apply the same owner/admin isolation used by the existing Studio domain.
do $$ declare t text; begin
  foreach t in array array['distribution_accounts','distribution_artist_profiles','release_distribution_configs','distribution_submissions','distribution_deliveries','distribution_validation_issues','distribution_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "admins select own %1$s" on public.%1$I for select to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins insert own %1$s" on public.%1$I for insert to authenticated with check (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
    if t <> 'distribution_submissions' then
      execute format('create policy "admins update own %1$s" on public.%1$I for update to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin()) with check (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
      execute format('create policy "admins delete own %1$s" on public.%1$I for delete to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
    end if;
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['distribution_accounts','distribution_artist_profiles','release_distribution_configs','distribution_deliveries','distribution_validation_issues'] loop
    execute format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

grant select,insert,update,delete on public.distribution_accounts, public.distribution_artist_profiles, public.release_distribution_configs, public.distribution_deliveries, public.distribution_validation_issues, public.distribution_events to authenticated;
grant select,insert on public.distribution_submissions to authenticated;
revoke all on public.distribution_accounts, public.distribution_artist_profiles, public.release_distribution_configs, public.distribution_submissions, public.distribution_deliveries, public.distribution_validation_issues, public.distribution_events from anon;
