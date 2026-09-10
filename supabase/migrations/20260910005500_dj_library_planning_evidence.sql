-- Phase 8 H3/H4: persist only path-free musical evidence required to plan local recordings.
-- Audio bytes and filesystem locations remain device-local.
alter table public.dj_library_source_tracks
  add column if not exists planning_evidence jsonb;

alter table public.dj_library_source_tracks
  drop constraint if exists dj_library_source_tracks_planning_evidence_shape;
alter table public.dj_library_source_tracks
  add constraint dj_library_source_tracks_planning_evidence_shape
  check (planning_evidence is null or jsonb_typeof(planning_evidence) = 'object');

create or replace function public.apply_dj_library_sync_revision(
  p_device_id uuid,
  p_source_id text,
  p_source_kind text,
  p_base_revision text,
  p_target_revision text,
  p_batch_count integer
) returns table(revision text, track_count integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_owner_id uuid;
  v_artist_id uuid;
  v_source_id uuid;
  v_current_revision text;
  v_current_count integer;
  v_chunk_count integer;
  v_chunk record;
  v_track jsonb;
  v_removed text;
begin
  select d.owner_id, d.artist_id
    into v_owner_id, v_artist_id
  from public.dj_library_devices d
  where d.id = p_device_id and d.revoked_at is null
  for update;

  if not found then
    raise exception 'device_not_active' using errcode = 'P0001';
  end if;

  select s.id, s.revision, s.track_count
    into v_source_id, v_current_revision, v_current_count
  from public.dj_library_device_sources s
  where s.device_id = p_device_id and s.source_id = p_source_id
  for update;

  if found and v_current_revision = p_target_revision then
    delete from public.dj_library_sync_chunks c
      where c.device_id = p_device_id and c.source_id = p_source_id and c.target_revision = p_target_revision;
    return query select p_target_revision, v_current_count;
    return;
  end if;

  if found then
    if v_current_revision is distinct from p_base_revision then
      raise exception 'source_revision_conflict' using errcode = 'P0001';
    end if;
  else
    if p_base_revision is not null then
      raise exception 'source_revision_conflict' using errcode = 'P0001';
    end if;
    insert into public.dj_library_device_sources (
      device_id, owner_id, artist_id, source_id, source_kind, revision, track_count
    ) values (
      p_device_id, v_owner_id, v_artist_id, p_source_id, p_source_kind, null, 0
    ) returning id into v_source_id;
  end if;

  select count(*)::integer into v_chunk_count
  from public.dj_library_sync_chunks c
  where c.device_id = p_device_id
    and c.source_id = p_source_id
    and c.target_revision = p_target_revision
    and c.batch_count = p_batch_count
    and c.batch_index >= 0
    and c.batch_index < p_batch_count;

  if v_chunk_count <> p_batch_count then
    raise exception 'sync_revision_incomplete' using errcode = 'P0001';
  end if;

  for v_chunk in
    select c.payload
    from public.dj_library_sync_chunks c
    where c.device_id = p_device_id
      and c.source_id = p_source_id
      and c.target_revision = p_target_revision
    order by c.batch_index asc
  loop
    for v_track in
      select value from jsonb_array_elements(coalesce(v_chunk.payload->'changedTracks', '[]'::jsonb))
    loop
      insert into public.dj_library_source_tracks as t (
        device_id, device_source_id, owner_id, artist_id, source_id, source_track_id,
        recording_fingerprint, metadata, playlist_ids, cue_points, beat_grid,
        analysis_provenance, planning_evidence, availability, revision
      ) values (
        p_device_id, v_source_id, v_owner_id, v_artist_id, p_source_id,
        v_track->>'sourceTrackId', v_track->>'recordingFingerprint',
        coalesce(v_track->'metadata', '{}'::jsonb),
        coalesce(v_track->'playlistIds', '[]'::jsonb),
        coalesce(v_track->'cuePoints', '[]'::jsonb),
        v_track->'beatGrid',
        coalesce(v_track->'analysisProvenance', '[]'::jsonb),
        v_track->'planningEvidence',
        coalesce(nullif(v_track->>'availability', ''), 'unknown'),
        p_target_revision
      )
      on conflict (device_id, source_id, source_track_id) do update set
        device_source_id = excluded.device_source_id,
        recording_fingerprint = excluded.recording_fingerprint,
        metadata = excluded.metadata,
        playlist_ids = excluded.playlist_ids,
        cue_points = excluded.cue_points,
        beat_grid = excluded.beat_grid,
        analysis_provenance = excluded.analysis_provenance,
        planning_evidence = excluded.planning_evidence,
        availability = excluded.availability,
        revision = excluded.revision;
    end loop;

    for v_removed in
      select value from jsonb_array_elements_text(coalesce(v_chunk.payload->'removedSourceTrackIds', '[]'::jsonb))
    loop
      delete from public.dj_library_source_tracks t
      where t.device_id = p_device_id
        and t.source_id = p_source_id
        and t.source_track_id = v_removed;
    end loop;
  end loop;

  select count(*)::integer into v_current_count
  from public.dj_library_source_tracks t
  where t.device_id = p_device_id and t.source_id = p_source_id;

  update public.dj_library_device_sources s set
    source_kind = p_source_kind,
    revision = p_target_revision,
    track_count = v_current_count,
    last_synced_at = now()
  where s.id = v_source_id;

  delete from public.dj_library_sync_chunks c
  where c.device_id = p_device_id and c.source_id = p_source_id and c.target_revision = p_target_revision;

  return query select p_target_revision, v_current_count;
end;
$$;
