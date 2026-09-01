create table public.creative_derivatives (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  master_content_item_id uuid not null references public.content_items(id) on delete cascade,
  derivative_content_item_id uuid not null references public.content_items(id) on delete cascade,
  master_generation_run_id uuid not null references public.generation_runs(id) on delete cascade,
  derivative_generation_run_id uuid references public.generation_runs(id) on delete set null,
  target_platform text not null,
  target_format text not null,
  target_package_id text not null,
  strategy text not null check (strategy in ('reuse_approved_image','deterministic_video_repackage')),
  auto_approve boolean not null default true,
  status text not null default 'planned' check (status in ('planned','processing','ready','failed','cancelled')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, master_content_item_id, target_package_id)
);

create index creative_derivatives_master_idx
  on public.creative_derivatives(owner_id, master_content_item_id, created_at desc);
create index creative_derivatives_child_idx
  on public.creative_derivatives(owner_id, derivative_content_item_id);
create index creative_derivatives_status_idx
  on public.creative_derivatives(status, created_at);

alter table public.creative_derivatives enable row level security;
create policy "admins manage own creative derivatives"
  on public.creative_derivatives for all to authenticated
  using (owner_id = (select auth.uid()) and private.is_studio_admin())
  with check (owner_id = (select auth.uid()) and private.is_studio_admin());

create trigger set_creative_derivatives_updated_at
  before update on public.creative_derivatives
  for each row execute function private.set_updated_at();

grant select, insert, update, delete on public.creative_derivatives to authenticated;
grant select, insert, update, delete on public.creative_derivatives to service_role;
