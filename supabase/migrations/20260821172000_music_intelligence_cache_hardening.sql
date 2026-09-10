-- Music Intelligence v2 cache hardening.
-- A canonical real v2 map must always beat a local estimate, and legacy completed
-- analysis jobs must not block a one-time v2 upgrade through their old idempotency key.

create or replace function private.prefer_canonical_track_music_intelligence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_analysis jsonb;
begin
  if coalesce(new.music_map->>'source', '') = 'worker'
     and coalesce((new.music_map->>'version')::integer, 1) >= 2 then
    return new;
  end if;

  select i.analysis into v_analysis
  from public.track_music_intelligence i
  where i.track_id = new.track_id
    and i.owner_id = new.owner_id
    and i.analysis_version >= 2
    and coalesce(i.analysis->>'source', '') = 'worker'
  order by i.analysis_version desc, i.analyzed_at desc
  limit 1;

  if v_analysis is null then
    return new;
  end if;

  new.music_map := v_analysis;
  new.analysis_completed_at := coalesce(new.analysis_completed_at, now());
  new.last_error := null;
  if new.status in ('draft','analyzing_audio','blocked') then
    new.status := 'concept_review';
    new.previous_status := null;
  end if;
  return new;
end;
$$;

revoke all on function private.prefer_canonical_track_music_intelligence() from public, anon, authenticated;

create trigger prefer_canonical_track_music_intelligence
  before insert or update of music_map, track_id
  on public.music_video_projects
  for each row execute function private.prefer_canonical_track_music_intelligence();

-- Old analyze jobs used an idempotency key that did not include the analysis schema version.
-- Move only completed pre-v2 jobs aside so the next Analyze/Upgrade action can create one v2 job.
update public.music_video_worker_jobs j
set idempotency_key = 'legacy-v1:' || j.id::text || ':' || j.idempotency_key,
    updated_at = now()
where j.job_type = 'analyze_audio'
  and j.status = 'completed'
  and coalesce((j.result_payload#>>'{music_map,version}')::integer, 1) < 2
  and j.idempotency_key not like 'legacy-v1:%';
