-- Artist Growth OS: unreleased vault, explainable release planning, catalog opportunities,
-- and persistent release playbooks. All decision-engine work is deterministic and free;
-- paid AI remains behind the existing explicit generation approval gates.

alter table public.tasks
  add column if not exists category text not null default 'general',
  add column if not exists external_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists tasks_release_external_key_uidx
  on public.tasks(owner_id, release_id, external_key)
  where release_id is not null and external_key is not null;

create table public.artist_growth_settings (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  north_star text not null default 'active_fanbase',
  planning_horizon_days integer not null default 90 check (planning_horizon_days between 30 and 365),
  release_cadence_days integer not null default 28 check (release_cadence_days between 7 and 120),
  minimum_candidate_score integer not null default 55 check (minimum_candidate_score between 0 and 100),
  catalog_engine_enabled boolean not null default true,
  autoplan_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.track_vault (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  linked_release_id uuid references public.releases(id) on delete set null,
  title text not null,
  version text,
  status text not null default 'mastered' check (status in ('idea','demo','mix','mastered','release_candidate','scheduled','released','hold','archived')),
  audio_url text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  notes text,
  source text not null default 'manual' check (source in ('manual','backfill','import','generator')),
  artist_rating smallint check (artist_rating is null or artist_rating between 1 and 5),
  hook_strength smallint not null default 50 check (hook_strength between 0 and 100),
  short_form_potential smallint not null default 50 check (short_form_potential between 0 and 100),
  visual_potential smallint not null default 50 check (visual_potential between 0 and 100),
  uniqueness_score smallint not null default 50 check (uniqueness_score between 0 and 100),
  release_readiness smallint not null default 50 check (release_readiness between 0 and 100),
  hook_start_seconds integer check (hook_start_seconds is null or hook_start_seconds >= 0),
  hook_end_seconds integer check (hook_end_seconds is null or hook_end_seconds >= 0),
  hold_until date,
  analysis_confidence numeric(4,3) not null default 0 check (analysis_confidence between 0 and 1),
  audio_profile jsonb not null default '{}'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint track_vault_hook_range check (
    hook_start_seconds is null or hook_end_seconds is null or hook_end_seconds >= hook_start_seconds
  )
);

create index track_vault_owner_status_idx on public.track_vault(owner_id, status, updated_at desc);
create index track_vault_linked_release_idx on public.track_vault(linked_release_id) where linked_release_id is not null;

create table public.growth_plan_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  track_vault_id uuid references public.track_vault(id) on delete cascade,
  release_id uuid references public.releases(id) on delete cascade,
  target_date date not null,
  sort_order integer not null default 0,
  candidate_score numeric(5,2) not null default 0 check (candidate_score between 0 and 100),
  rationale text not null default '',
  status text not null default 'proposed' check (status in ('proposed','accepted','scheduled','completed','skipped')),
  source text not null default 'decision_engine' check (source in ('decision_engine','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint growth_plan_item_target check (track_vault_id is not null or release_id is not null)
);

create index growth_plan_owner_date_idx on public.growth_plan_items(owner_id, target_date, sort_order);
create unique index growth_plan_track_proposal_uidx
  on public.growth_plan_items(owner_id, track_vault_id)
  where track_vault_id is not null and status in ('proposed','accepted','scheduled');

create table public.growth_opportunities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('catalog_revival','content_breakout','release_risk','funnel_bottleneck','release_candidate')),
  release_id uuid references public.releases(id) on delete cascade,
  track_vault_id uuid references public.track_vault(id) on delete cascade,
  content_item_id uuid references public.content_items(id) on delete cascade,
  title text not null,
  rationale text not null,
  priority smallint not null default 50 check (priority between 0 and 100),
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  evidence jsonb not null default '{}'::jsonb,
  recommended_action jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  status text not null default 'new' check (status in ('new','accepted','dismissed','completed','expired')),
  detected_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, dedupe_key)
);

create index growth_opportunity_owner_status_idx on public.growth_opportunities(owner_id, status, priority desc, detected_at desc);
create index growth_opportunity_release_idx on public.growth_opportunities(release_id) where release_id is not null;

-- Existing unfinished release tracks become visible in the new vault immediately without
-- duplicating released catalog. The vault remains independent for all future orphan tracks.
insert into public.track_vault (
  owner_id, linked_release_id, title, version, status, audio_url, duration_seconds, notes, source,
  hook_strength, short_form_potential, visual_potential, uniqueness_score, release_readiness
)
select
  t.owner_id,
  t.release_id,
  t.title,
  t.version,
  case
    when r.status = 'Scheduled' then 'scheduled'
    when r.status = 'In Progress' then 'release_candidate'
    else 'mastered'
  end,
  t.audio_url,
  t.duration,
  t.notes,
  'backfill',
  50, 50, 50, 50,
  case when r.status = 'Scheduled' then 90 when r.status = 'In Progress' then 70 else 55 end
from public.tracks t
join public.releases r on r.id = t.release_id
where r.status in ('Idea','In Progress','Scheduled')
  and not exists (
    select 1 from public.track_vault v
    where v.owner_id = t.owner_id and v.linked_release_id = t.release_id and v.title = t.title
  );

-- Idempotent release playbook. This intentionally writes only free internal tasks.
create or replace function private.ensure_release_growth_playbook(p_release_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.releases%rowtype;
begin
  select * into r from public.releases where id = p_release_id;
  if not found then return; end if;

  insert into public.tasks(owner_id, release_id, title, status, priority, due_at, category, external_key, metadata)
  values
    (r.owner_id, r.id, 'Choose the strongest short-form hook', 'Open', 'High', case when r.release_date is null then null else ((r.release_date - 21)::timestamp + time '10:00') at time zone 'Europe/Berlin' end, 'growth', 'growth.hook-test', '{"phase":"prepare","description":"Test the musical moment before spending on finished creative."}'::jsonb),
    (r.owner_id, r.id, 'Pitch the release in Spotify for Artists', 'Open', 'High', case when r.release_date is null then null else ((r.release_date - 14)::timestamp + time '10:00') at time zone 'Europe/Berlin' end, 'spotify', 'spotify.pitch', '{"phase":"prepare","description":"Prepare the editorial pitch with enough lead time."}'::jsonb),
    (r.owner_id, r.id, 'Prepare pre-save / smart link', 'Open', 'High', case when r.release_date is null then null else ((r.release_date - 14)::timestamp + time '11:00') at time zone 'Europe/Berlin' end, 'spotify', 'spotify.presave', '{"phase":"build_hype","description":"One measurable destination for campaign traffic."}'::jsonb),
    (r.owner_id, r.id, 'Create Spotify Canvas', 'Open', 'Medium', case when r.release_date is null then null else ((r.release_date - 7)::timestamp + time '10:00') at time zone 'Europe/Berlin' end, 'spotify', 'spotify.canvas', '{"phase":"build_hype","description":"Keep the visual world consistent with the winning campaign concept."}'::jsonb),
    (r.owner_id, r.id, 'Set up Countdown Page if the release is eligible', 'Open', 'Medium', case when r.release_date is null then null else ((r.release_date - 14)::timestamp + time '12:00') at time zone 'Europe/Berlin' end, 'spotify', 'spotify.countdown', '{"phase":"build_hype","conditional":true,"description":"Use only when Spotify makes the release eligible."}'::jsonb),
    (r.owner_id, r.id, 'Turn the winning hook into three native derivatives', 'Open', 'High', case when r.release_date is null then null else ((r.release_date - 7)::timestamp + time '11:00') at time zone 'Europe/Berlin' end, 'creative', 'growth.derivatives', '{"phase":"build_hype","description":"Scale the winner instead of producing unrelated filler."}'::jsonb),
    (r.owner_id, r.id, 'Refresh Artist Pick and release-facing profile surfaces', 'Open', 'High', case when r.release_date is null then null else (r.release_date::timestamp + time '09:00') at time zone 'Europe/Berlin' end, 'spotify', 'spotify.artist-pick', '{"phase":"release","description":"Make the release the obvious next action for profile visitors."}'::jsonb),
    (r.owner_id, r.id, 'Review the first seven days and decide what to scale', 'Open', 'High', case when r.release_date is null then null else ((r.release_date + 7)::timestamp + time '10:00') at time zone 'Europe/Berlin' end, 'growth', 'growth.week-one-review', '{"phase":"sustain","description":"Scale winning creative and capture evidence-backed learnings."}'::jsonb),
    (r.owner_id, r.id, 'Check whether this track deserves a catalog revival', 'Open', 'Medium', case when r.release_date is null then null else ((r.release_date + 28)::timestamp + time '10:00') at time zone 'Europe/Berlin' end, 'growth', 'growth.catalog-review', '{"phase":"sustain","description":"Do not let a release disappear just because launch week ended."}'::jsonb)
  on conflict (owner_id, release_id, external_key) where release_id is not null and external_key is not null
  do update set
    due_at = excluded.due_at,
    category = excluded.category,
    metadata = excluded.metadata,
    updated_at = now();
end;
$$;

revoke all on function private.ensure_release_growth_playbook(uuid) from public, anon, authenticated;

create or replace function private.sync_release_growth_playbook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_release_growth_playbook(new.id);
  return new;
end;
$$;

revoke all on function private.sync_release_growth_playbook() from public, anon, authenticated;

drop trigger if exists sync_release_growth_playbook on public.releases;
create trigger sync_release_growth_playbook
after insert or update of release_date on public.releases
for each row execute function private.sync_release_growth_playbook();

do $$
declare rid uuid;
begin
  for rid in select id from public.releases loop
    perform private.ensure_release_growth_playbook(rid);
  end loop;
end $$;

-- Admin-only ownership policies matching the rest of Studio.
alter table public.artist_growth_settings enable row level security;
alter table public.track_vault enable row level security;
alter table public.growth_plan_items enable row level security;
alter table public.growth_opportunities enable row level security;

do $$
declare t text;
begin
  foreach t in array array['artist_growth_settings','track_vault','growth_plan_items','growth_opportunities'] loop
    execute format('create policy "admins select own %1$s" on public.%1$I for select to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins insert own %1$s" on public.%1$I for insert to authenticated with check (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins update own %1$s" on public.%1$I for update to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin()) with check (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
    execute format('create policy "admins delete own %1$s" on public.%1$I for delete to authenticated using (owner_id=(select auth.uid()) and private.is_studio_admin())', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['artist_growth_settings','track_vault','growth_plan_items','growth_opportunities'] loop
    execute format('create trigger set_%1$s_updated_at before update on public.%1$I for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

grant select, insert, update, delete on public.artist_growth_settings to authenticated;
grant select, insert, update, delete on public.track_vault to authenticated;
grant select, insert, update, delete on public.growth_plan_items to authenticated;
grant select, insert, update, delete on public.growth_opportunities to authenticated;
