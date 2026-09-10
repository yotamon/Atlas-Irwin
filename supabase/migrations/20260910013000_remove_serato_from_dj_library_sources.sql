-- Phase 8 scope decision: Serato is intentionally not an active Ensemblis source.
-- Keep the database aligned with the TypeScript/native source contract so unsupported
-- providers cannot enter synchronized source state through a stale client.

alter table public.dj_library_device_sources
  drop constraint if exists dj_library_device_sources_source_kind_check;
alter table public.dj_library_device_sources
  add constraint dj_library_device_sources_source_kind_check
  check (source_kind in ('local_library', 'rekordbox', 'traktor'));

alter table public.dj_library_sync_chunks
  drop constraint if exists dj_library_sync_chunks_source_kind_check;
alter table public.dj_library_sync_chunks
  add constraint dj_library_sync_chunks_source_kind_check
  check (source_kind in ('local_library', 'rekordbox', 'traktor'));

comment on column public.dj_library_device_sources.source_kind is
  'Active provider-neutral DJ library kind. Phase 8 supports local library, Rekordbox and Traktor contracts; additional providers require an explicit later contract change.';
