-- Lyrics Intelligence hardening
-- Revisions are an immutable audit log. Canonical writes happen only through save_track_lyrics().

alter table public.track_lyrics_revisions
  add column if not exists updated_at timestamptz not null default now();

drop policy if exists "admins insert own track_lyrics_revisions" on public.track_lyrics_revisions;
drop policy if exists "admins update own track_lyrics_revisions" on public.track_lyrics_revisions;
drop policy if exists "admins delete own track_lyrics_revisions" on public.track_lyrics_revisions;

revoke insert, update, delete on public.track_lyrics_revisions from authenticated;
grant select on public.track_lyrics_revisions to authenticated;

-- Derived intelligence is written by trusted server actions. Users may read it, while the
-- canonical save/analyze flows remain the only mutation surface presented by Studio.
comment on table public.track_lyrics_revisions is
  'Immutable canonical lyrics revision history. New revisions are inserted only by save_track_lyrics().';
comment on table public.track_lyrics_analysis is
  'Versioned semantic Lyrics Intelligence derived from a specific canonical lyrics version.';
comment on table public.track_lyric_moments is
  'Operational lyric moments grounded in exact official excerpts and optionally aligned to Track Intelligence.';