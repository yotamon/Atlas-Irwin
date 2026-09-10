-- Stem Intelligence follow-up indexes
-- Cover foreign keys introduced by the Stem Intelligence schema so deletes,
-- updates, and relationship lookups do not require avoidable table scans.

create index if not exists content_items_audio_scene_idx
  on public.content_items(audio_scene_id)
  where audio_scene_id is not null;

create index if not exists music_video_projects_audio_scene_idx
  on public.music_video_projects(audio_scene_id)
  where audio_scene_id is not null;

create index if not exists music_video_renders_audio_scene_idx
  on public.music_video_renders(audio_scene_id)
  where audio_scene_id is not null;

create index if not exists track_stem_jobs_stem_idx
  on public.track_stem_jobs(stem_id)
  where stem_id is not null;

create index if not exists track_stem_jobs_scene_idx
  on public.track_stem_jobs(scene_id)
  where scene_id is not null;

create index if not exists track_stem_jobs_track_fk_idx
  on public.track_stem_jobs(track_id);

create index if not exists track_stems_source_master_asset_idx
  on public.track_stems(source_master_media_asset_id)
  where source_master_media_asset_id is not null;
