-- A release-linked Track Vault entry is another valid entry point to Music Intelligence.
-- Promote completed v2 worker maps into the same canonical per-track cache consumed by
-- Video Director and Marketing, without requiring a Video Director project to exist first.

create or replace function private.sync_vault_music_intelligence_to_track()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track_id uuid;
  v_engine text;
  v_quality text;
  v_semantic boolean;
  v_version integer;
begin
  if new.linked_release_id is null then
    return new;
  end if;
  if coalesce(new.audio_profile->>'source', '') <> 'worker' then
    return new;
  end if;

  v_version := greatest(1, coalesce((new.audio_profile->>'version')::integer, 1));
  if v_version < 2 then
    return new;
  end if;

  select t.id into v_track_id
  from public.tracks t
  where t.owner_id = new.owner_id
    and t.release_id = new.linked_release_id
  order by
    (lower(t.title) = lower(new.title)) desc,
    t.is_primary desc,
    t.created_at asc
  limit 1;

  if v_track_id is null then
    return new;
  end if;

  v_engine := coalesce(new.audio_profile#>>'{analysis,engine}', 'worker');
  v_quality := case when new.audio_profile#>>'{analysis,quality}' = 'fallback' then 'fallback' else 'full' end;
  v_semantic := coalesce((new.audio_profile#>>'{analysis,semantic_structure}')::boolean, false);

  insert into public.track_music_intelligence(
    track_id,
    owner_id,
    analysis_version,
    engine,
    quality,
    semantic_structure,
    analysis,
    analyzed_at
  ) values (
    v_track_id,
    new.owner_id,
    v_version,
    v_engine,
    v_quality,
    v_semantic,
    new.audio_profile,
    now()
  )
  on conflict (track_id) do update set
    owner_id = excluded.owner_id,
    analysis_version = excluded.analysis_version,
    engine = excluded.engine,
    quality = excluded.quality,
    semantic_structure = excluded.semantic_structure,
    analysis = excluded.analysis,
    analyzed_at = excluded.analyzed_at,
    updated_at = now()
  where excluded.analysis_version >= public.track_music_intelligence.analysis_version;

  return new;
end;
$$;

revoke all on function private.sync_vault_music_intelligence_to_track() from public, anon, authenticated;

create trigger sync_vault_music_intelligence_to_track
  after insert or update of audio_profile, linked_release_id
  on public.track_vault
  for each row execute function private.sync_vault_music_intelligence_to_track();

-- Existing release-linked vault tracks analyzed by a v2 worker are promoted immediately.
update public.track_vault
set audio_profile = audio_profile
where linked_release_id is not null
  and coalesce(audio_profile->>'source', '') = 'worker'
  and coalesce((audio_profile->>'version')::integer, 1) >= 2;
