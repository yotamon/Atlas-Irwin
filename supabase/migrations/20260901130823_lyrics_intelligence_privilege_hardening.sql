-- Lyrics Intelligence privilege hardening
-- Keep the public API surface least-privileged. Canonical lyrics mutate only through
-- save_track_lyrics(); derived intelligence gets only the operations used by the trusted
-- Studio server analysis path. Anonymous clients have no table privileges in this domain.

revoke all privileges on table
  public.track_lyrics,
  public.track_lyrics_revisions,
  public.track_lyric_sections,
  public.track_lyric_lines,
  public.track_lyrics_analysis,
  public.track_lyric_moments
from anon, authenticated;

grant select on table
  public.track_lyrics,
  public.track_lyrics_revisions,
  public.track_lyric_lines
  to authenticated;

grant select, update on table public.track_lyric_sections to authenticated;
grant select, insert, update on table public.track_lyrics_analysis to authenticated;
grant select, insert, delete on table public.track_lyric_moments to authenticated;

comment on table public.track_lyrics is
  'Canonical official lyrics. Authenticated clients may read; canonical mutation is only through save_track_lyrics().';