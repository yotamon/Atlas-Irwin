-- Video Director human quality gate.
-- Vision models may flag continuity/artifact risk, but lip-sync is never auto-approved from sparse frames.
-- A locked performance/identity shot must carry explicit human attestation for that exact selected asset.

create or replace function private.validate_music_video_human_quality_gate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  missing_count integer;
begin
  if new.status::text <> 'ready_to_render' or old.status::text = 'ready_to_render' then
    return new;
  end if;

  select count(*) into missing_count
  from public.music_video_shots s
  where s.project_id = new.id
    and s.owner_id = new.owner_id
    and (
      s.character_id is not null
      or coalesce((s.performance_config->>'lip_sync')::boolean, false) = true
    )
    and (
      s.selected_asset_id is null
      or coalesce(s.quality_checks->>'review_asset_id', '') <> s.selected_asset_id::text
      or (
        s.character_id is not null
        and coalesce((s.quality_checks->>'continuity_approved')::boolean, false) = false
      )
      or (
        coalesce((s.performance_config->>'lip_sync')::boolean, false) = true
        and coalesce((s.quality_checks->>'lip_sync_approved')::boolean, false) = false
      )
    );

  if missing_count > 0 then
    raise exception '% shot(s) still require explicit human identity/lip-sync quality approval for their current locked variant before rendering', missing_count;
  end if;
  return new;
end;
$$;

revoke all on function private.validate_music_video_human_quality_gate() from public, anon, authenticated;

drop trigger if exists music_video_projects_human_quality_gate on public.music_video_projects;
create trigger music_video_projects_human_quality_gate
  before update of status on public.music_video_projects
  for each row execute function private.validate_music_video_human_quality_gate();
