-- The Studio media library is public-only by product decision.

alter table public.media_assets
  alter column visibility set default 'public';

update storage.buckets
set
  file_size_limit = 104857600,
  allowed_mime_types = array[
    'image/jpeg','image/png','image/webp','image/avif',
    'video/mp4','video/webm',
    'audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/flac',
    'application/zip'
  ]
where id = 'public-media';
