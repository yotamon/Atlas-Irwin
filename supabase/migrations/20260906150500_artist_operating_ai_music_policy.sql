-- Keep music-generation permission explicit and separate from project provenance.
-- Human artists default to no AI music generation; AI-assisted/hybrid projects may opt in through settings.
alter table public.artist_operating_profiles
  add column if not exists ai_music_allowed boolean not null default false;
