create table public.marketing_media_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  release_id uuid references public.releases(id) on delete set null,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  generation_run_id uuid references public.generation_runs(id) on delete set null,
  job_type text not null check (job_type in ('finish_social_video')),
  status text not null default 'planned' check (status in ('planned','queued','running','completed','failed','cancelled')),
  idempotency_key text not null,
  request_payload jsonb not null default '{}',
  result_payload jsonb not null default '{}',
  external_job_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, idempotency_key)
);

create index marketing_media_jobs_status_created_idx
  on public.marketing_media_jobs(status, created_at);
create index marketing_media_jobs_content_idx
  on public.marketing_media_jobs(owner_id, content_item_id, created_at desc);
create index marketing_media_jobs_generation_idx
  on public.marketing_media_jobs(owner_id, generation_run_id)
  where generation_run_id is not null;

alter table public.marketing_media_jobs enable row level security;

create policy "admins manage own marketing media jobs"
  on public.marketing_media_jobs for all to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());

create trigger set_marketing_media_jobs_updated_at
  before update on public.marketing_media_jobs
  for each row execute function private.set_updated_at();

grant select, insert, update, delete on public.marketing_media_jobs to authenticated;
grant select, insert, update, delete on public.marketing_media_jobs to service_role;
