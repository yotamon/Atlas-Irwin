-- Lyrics Intelligence foreign-key indexes
-- Cover every Lyrics-domain foreign key flagged by the Supabase performance advisor.

create index if not exists track_lyrics_revisions_owner_idx
  on public.track_lyrics_revisions(owner_id);
create index if not exists track_lyric_sections_owner_idx
  on public.track_lyric_sections(owner_id);
create index if not exists track_lyric_lines_lyrics_idx
  on public.track_lyric_lines(lyrics_id);
create index if not exists track_lyric_lines_owner_idx
  on public.track_lyric_lines(owner_id);
create index if not exists track_lyrics_analysis_owner_idx
  on public.track_lyrics_analysis(owner_id);
create index if not exists track_lyric_moments_lyrics_idx
  on public.track_lyric_moments(lyrics_id);
create index if not exists track_lyric_moments_owner_idx
  on public.track_lyric_moments(owner_id);