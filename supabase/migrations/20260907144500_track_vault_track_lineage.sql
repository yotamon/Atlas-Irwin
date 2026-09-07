-- Give every catalog track its own durable Music Intelligence identity.
-- Release-level lineage remains for compatibility, but multi-track releases must never
-- collapse several songs onto one track_vault row.

alter table public.track_vault
  add column if not exists linked_track_id uuid references public.tracks(id) on delete set null;

-- Backfill only unambiguous exact-title matches. If legacy data is ambiguous we leave
-- linked_track_id null rather than attaching intelligence to the wrong song.
with exact_candidates as (
  select
    v.id as vault_id,
    t.id as track_id,
    row_number() over (
      partition by t.id
      order by v.updated_at desc nulls last, v.created_at desc, v.id
    ) as vault_rank,
    count(*) over (partition by v.id) as track_matches
  from public.track_vault v
  join public.tracks t
    on t.release_id = v.linked_release_id
   and t.owner_id = v.owner_id
   and (v.artist_id is null or t.artist_id = v.artist_id)
   and lower(btrim(t.title)) = lower(btrim(v.title))
  where v.linked_release_id is not null
    and v.linked_track_id is null
)
update public.track_vault v
set linked_track_id = c.track_id
from exact_candidates c
where v.id = c.vault_id
  and c.track_matches = 1
  and c.vault_rank = 1;

-- A one-track release is also unambiguous even when old titles drifted.
with single_track_releases as (
  select
    release_id,
    owner_id,
    artist_id,
    min(id::text)::uuid as track_id
  from public.tracks
  group by release_id, owner_id, artist_id
  having count(*) = 1
), ranked_vaults as (
  select
    v.id as vault_id,
    s.track_id,
    row_number() over (
      partition by s.track_id
      order by v.updated_at desc nulls last, v.created_at desc, v.id
    ) as vault_rank
  from public.track_vault v
  join single_track_releases s
    on s.release_id = v.linked_release_id
   and s.owner_id = v.owner_id
   and (v.artist_id is null or s.artist_id = v.artist_id)
  where v.linked_track_id is null
)
update public.track_vault v
set linked_track_id = r.track_id
from ranked_vaults r
where v.id = r.vault_id
  and r.vault_rank = 1;

create unique index if not exists track_vault_artist_track_uidx
  on public.track_vault(owner_id, artist_id, linked_track_id)
  where linked_track_id is not null;

create index if not exists track_vault_linked_track_idx
  on public.track_vault(linked_track_id)
  where linked_track_id is not null;

comment on column public.track_vault.linked_track_id is
  'Exact catalog track represented by this Music Intelligence row. Required for reliable multi-track release identity; linked_release_id is collection context only.';
