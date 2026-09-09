-- Private, short-lived transition previews for verified AutoMix plans.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'automix-previews',
  'automix-previews',
  false,
  20971520,
  array['audio/mpeg']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.automix_transition_previews (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  automix_job_id uuid not null references public.automix_jobs(id) on delete cascade,
  transition_index integer not null check (transition_index >= 0 and transition_index < 20),
  status text not null default 'planned'
    check (status in ('planned','queued','running','completed','failed','cancelled')),
  idempotency_key text not null unique,
  output_bucket text not null default 'automix-previews',
  output_path text not null,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  external_job_id text,
  error text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  started_at timestamptz,
  completed_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automix_transition_previews_owner_idx
  on public.automix_transition_previews(owner_id, artist_id, created_at desc);
create index if not exists automix_transition_previews_expiry_idx
  on public.automix_transition_previews(expires_at)
  where status = 'completed' and purged_at is null;
create unique index if not exists automix_transition_previews_active_transition_idx
  on public.automix_transition_previews(owner_id, automix_job_id, transition_index)
  where status in ('planned','queued','running');

create or replace function private.validate_automix_transition_preview()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_owner uuid;
  parent_artist uuid;
  parent_status text;
  transition_count integer;
  parent_plan_hash text;
begin
  select owner_id,
         artist_id,
         status,
         coalesce(jsonb_array_length(result_payload->'render_manifest'->'transitions'), 0),
         nullif(result_payload->'render_manifest'->>'plan_hash', '')
    into parent_owner, parent_artist, parent_status, transition_count, parent_plan_hash
  from public.automix_jobs
  where id = new.automix_job_id;

  if parent_owner is null then
    raise exception 'AutoMix parent session does not exist';
  end if;
  if parent_owner <> new.owner_id or parent_artist <> new.artist_id then
    raise exception 'Transition preview lineage must match the parent AutoMix session';
  end if;
  if parent_status <> 'completed' then
    raise exception 'Transition previews require a completed verified AutoMix session';
  end if;
  if parent_plan_hash is null then
    raise exception 'Transition previews require a verified MixPlan hash';
  end if;
  if new.transition_index >= transition_count then
    raise exception 'Transition preview index is outside the verified parent MixPlan';
  end if;
  if new.expires_at > now() + interval '25 hours' then
    raise exception 'Transition preview retention cannot exceed 25 hours';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_automix_transition_preview() from public, anon, authenticated;

drop trigger if exists automix_transition_previews_validate on public.automix_transition_previews;
create trigger automix_transition_previews_validate
  before insert or update of owner_id, artist_id, automix_job_id, transition_index, expires_at
  on public.automix_transition_previews
  for each row execute function private.validate_automix_transition_preview();

drop trigger if exists set_automix_transition_previews_updated_at on public.automix_transition_previews;
create trigger set_automix_transition_previews_updated_at
  before update on public.automix_transition_previews
  for each row execute function private.set_updated_at();

alter table public.automix_transition_previews enable row level security;

drop policy if exists "automix_transition_previews_select_own" on public.automix_transition_previews;
create policy "automix_transition_previews_select_own"
  on public.automix_transition_previews for select to authenticated
  using (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

drop policy if exists "automix_transition_previews_insert_own" on public.automix_transition_previews;
create policy "automix_transition_previews_insert_own"
  on public.automix_transition_previews for insert to authenticated
  with check (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

drop policy if exists "automix_transition_previews_update_own" on public.automix_transition_previews;
create policy "automix_transition_previews_update_own"
  on public.automix_transition_previews for update to authenticated
  using (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  )
  with check (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

grant select, insert, update on public.automix_transition_previews to authenticated;

comment on table public.automix_transition_previews is
  'Short-lived private previews rendered from one transition of a verified MixPlan. Source masters remain canonical and unchanged; purged_at records private storage cleanup without erasing lineage.';
