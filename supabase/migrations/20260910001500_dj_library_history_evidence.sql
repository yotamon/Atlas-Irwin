-- DJ Library history evidence for Personal DJ Intelligence.
-- Stores bounded aggregate preference signals only. Raw library paths, collection rows and
-- per-track play histories remain outside the cloud evidence table.

create table if not exists public.dj_library_history_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  source_kind text not null
    check (source_kind in ('rekordbox','serato','traktor','local_library')),
  source_id text not null check (char_length(source_id) between 1 and 160),
  source_revision text not null check (char_length(source_revision) between 1 and 200),
  evidence_key text not null check (char_length(evidence_key) between 1 and 160),
  signal jsonb not null default '{}'::jsonb,
  weight real not null default 0.2 check (weight > 0 and weight <= 0.4),
  sample_count integer not null default 0 check (sample_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(signal) = 'object'),
  unique (owner_id, artist_id, source_kind, source_id, source_revision, evidence_key)
);

create index if not exists dj_library_history_evidence_artist_idx
  on public.dj_library_history_evidence(owner_id, artist_id, created_at desc);

create index if not exists dj_library_history_evidence_source_idx
  on public.dj_library_history_evidence(owner_id, artist_id, source_kind, source_id, created_at desc);

drop trigger if exists set_dj_library_history_evidence_updated_at on public.dj_library_history_evidence;
create trigger set_dj_library_history_evidence_updated_at
  before update on public.dj_library_history_evidence
  for each row execute function private.set_updated_at();

alter table public.dj_library_history_evidence enable row level security;

drop policy if exists "dj_library_history_evidence_select_own" on public.dj_library_history_evidence;
create policy "dj_library_history_evidence_select_own"
  on public.dj_library_history_evidence for select to authenticated
  using (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

drop policy if exists "dj_library_history_evidence_insert_own" on public.dj_library_history_evidence;
create policy "dj_library_history_evidence_insert_own"
  on public.dj_library_history_evidence for insert to authenticated
  with check (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

drop policy if exists "dj_library_history_evidence_update_own" on public.dj_library_history_evidence;
create policy "dj_library_history_evidence_update_own"
  on public.dj_library_history_evidence for update to authenticated
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

grant select, insert, update on public.dj_library_history_evidence to authenticated;

comment on table public.dj_library_history_evidence is
  'Bounded aggregate DJ-library history evidence for the existing Personal DJ Profile. Raw paths and per-track library history are intentionally not persisted here.';
comment on column public.dj_library_history_evidence.weight is
  'Weak observational evidence capped at 0.4 so imported history cannot outweigh deliberate Set Builder feedback.';
