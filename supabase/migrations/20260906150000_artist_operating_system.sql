-- Ensemblis Artist Operating System.
--
-- This slice makes AI optional, captures how each artist wants Ensemblis to work,
-- and adds evidence-backed scene/strategy context without creating a parallel artist identity.
-- Canonical music, Moments, Growth Opportunities, Artist Memory and Autonomy remain the systems of record.

create table public.artist_operating_profiles (
  artist_id uuid primary key references public.artists(id) on delete cascade,
  marketing_involvement text not null default 'guided'
    check (marketing_involvement in ('hands_on','guided','just_make_music')),
  career_stage text not null default 'emerging'
    check (career_stage in ('starting','emerging','active','established')),
  primary_goal text not null default 'get_heard'
    check (primary_goal in ('get_heard','release_music','get_gigs','grow_fans','find_labels','build_owned_audience')),
  visibility_mode text not null default 'selective'
    check (visibility_mode in ('face_forward','selective','music_first','anonymous')),
  content_comfort text[] not null default '{}'::text[]
    check (content_comfort <@ array['camera','live','studio','photos','artwork','graphics']::text[]),
  release_cadence text not null default 'steady'
    check (release_cadence in ('frequent','steady','occasional')),
  monthly_budget_cents integer not null default 0 check (monthly_budget_cents >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  ai_writing_allowed boolean not null default true,
  ai_visuals_allowed boolean not null default false,
  ai_voice_allowed boolean not null default false,
  ai_likeness_allowed boolean not null default false,
  disclosure_preference text not null default 'required_only'
    check (disclosure_preference in ('required_only','always')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.artist_goals (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  kind text not null
    check (kind in ('get_heard','release_music','get_gigs','grow_fans','find_labels','build_owned_audience')),
  priority smallint not null default 50 check (priority between 0 and 100),
  status text not null default 'active' check (status in ('active','paused','achieved')),
  target jsonb not null default '{}'::jsonb check (jsonb_typeof(target) = 'object'),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_id, kind)
);

create table public.artist_scene_profiles (
  artist_id uuid primary key references public.artists(id) on delete cascade,
  primary_scene text,
  sub_scenes text[] not null default '{}'::text[],
  geographic_affinities text[] not null default '{}'::text[],
  audience_hypotheses jsonb not null default '[]'::jsonb check (jsonb_typeof(audience_hypotheses) = 'array'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.artist_scene_relationships (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  relationship_type text not null
    check (relationship_type in ('similar_artist','label','playlist','channel','promoter','venue','festival','market','community')),
  target_name text not null check (length(trim(target_name)) > 0),
  target_url text,
  external_id text,
  fit_score smallint not null default 50 check (fit_score between 0 and 100),
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  status text not null default 'candidate' check (status in ('candidate','verified','dismissed','contacted')),
  observed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_id, relationship_type, target_name),
  constraint verified_scene_relationship_requires_evidence
    check (status <> 'verified' or evidence <> '{}'::jsonb)
);

create index artist_scene_relationships_artist_fit_idx
  on public.artist_scene_relationships(artist_id, status, fit_score desc, confidence desc);

create table public.artist_strategy_snapshots (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete cascade,
  status text not null default 'active' check (status in ('active','superseded')),
  strategy jsonb not null default '{}'::jsonb check (jsonb_typeof(strategy) = 'object'),
  source_context jsonb not null default '{}'::jsonb check (jsonb_typeof(source_context) = 'object'),
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);

create unique index artist_strategy_one_active_idx
  on public.artist_strategy_snapshots(artist_id)
  where status = 'active';
create index artist_strategy_history_idx
  on public.artist_strategy_snapshots(artist_id, created_at desc);

-- Reuse Growth OS opportunities rather than creating a second opportunity queue.
alter table public.growth_opportunities
  drop constraint if exists growth_opportunities_kind_check;
alter table public.growth_opportunities
  add constraint growth_opportunities_kind_check check (kind in (
    'catalog_revival','content_breakout','release_risk','funnel_bottleneck','release_candidate',
    'scene_fit','outreach_target','gig_fit','label_fit','playlist_fit','channel_fit'
  ));

-- New-workspace defaults intentionally remain conservative. We do not backfill a profile:
-- absence means "not yet explicitly configured", allowing onboarding to ask only after music is understood.

create trigger set_artist_operating_profiles_updated_at
  before update on public.artist_operating_profiles
  for each row execute function private.set_updated_at();
create trigger set_artist_goals_updated_at
  before update on public.artist_goals
  for each row execute function private.set_updated_at();
create trigger set_artist_scene_profiles_updated_at
  before update on public.artist_scene_profiles
  for each row execute function private.set_updated_at();
create trigger set_artist_scene_relationships_updated_at
  before update on public.artist_scene_relationships
  for each row execute function private.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array[
    'artist_operating_profiles',
    'artist_goals',
    'artist_scene_profiles',
    'artist_scene_relationships',
    'artist_strategy_snapshots'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "studio members read %1$s" on public.%1$I for select to authenticated using (private.is_studio_admin() and private.can_access_artist(artist_id))', t);
    execute format('create policy "studio members insert %1$s" on public.%1$I for insert to authenticated with check (private.is_studio_admin() and private.can_access_artist(artist_id))', t);
    execute format('create policy "studio members update %1$s" on public.%1$I for update to authenticated using (private.is_studio_admin() and private.can_access_artist(artist_id)) with check (private.is_studio_admin() and private.can_access_artist(artist_id))', t);
    execute format('create policy "studio members delete %1$s" on public.%1$I for delete to authenticated using (private.is_studio_admin() and private.can_access_artist(artist_id))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

comment on table public.artist_operating_profiles is
  'Explicit artist working preferences. AI capability is a policy, never an artist identity requirement.';
comment on table public.artist_scene_relationships is
  'Evidence-backed artist-to-scene ecosystem relationships. Weak priors must remain candidates and never become artist truth.';
comment on table public.artist_strategy_snapshots is
  'Versioned structured strategy derived from artist operating context; canonical evidence remains in source domains.';
