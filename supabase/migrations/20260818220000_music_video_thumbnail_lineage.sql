-- Atlas Video Director thumbnail lineage

create unique index if not exists media_assets_video_thumbnail_lineage_uidx
  on public.media_assets ((metadata->>'thumbnail_candidate_id'))
  where metadata ? 'thumbnail_candidate_id'
    and nullif(metadata->>'thumbnail_candidate_id', '') is not null;
