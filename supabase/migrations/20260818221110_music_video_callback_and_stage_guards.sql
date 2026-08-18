-- Atlas Video Director stage and callback idempotency guards

-- Provider and worker callbacks are at-least-once. Make the lineage identifiers globally
-- unique so concurrent retries cannot create duplicate Media Library records.
create unique index if not exists media_assets_video_generation_lineage_uidx
  on public.media_assets ((metadata->>'generation_id'))
  where metadata ? 'generation_id' and nullif(metadata->>'generation_id', '') is not null;

create unique index if not exists media_assets_video_render_lineage_uidx
  on public.media_assets ((metadata->>'render_id'))
  where metadata ? 'render_id' and nullif(metadata->>'render_id', '') is not null;

create or replace function private.validate_music_video_project_stage_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  test_indexes jsonb;
  planned_test_count integer;
  locked_test_count integer;
begin
  if new.status = old.status then
    return new;
  end if;

  -- Moving from test review into paid production must prove that every test shot selected
  -- by the approved production plan has a locked winner. UI state alone is not sufficient.
  if new.status = 'production' and old.status = 'test_review' then
    test_indexes := coalesce(new.production_plan->'test_shot_indexes', '[]'::jsonb);
    if jsonb_typeof(test_indexes) <> 'array' or jsonb_array_length(test_indexes) = 0 then
      raise exception 'Production plan must define at least one representative test shot';
    end if;

    with requested_indexes as (
      select distinct value::integer as display_order
      from jsonb_array_elements_text(test_indexes) value
      where value ~ '^[0-9]+$'
    )
    select count(*) into planned_test_count from requested_indexes;

    if planned_test_count <> jsonb_array_length(test_indexes) then
      raise exception 'Production plan contains an invalid test shot index';
    end if;

    with requested_indexes as (
      select distinct value::integer as display_order
      from jsonb_array_elements_text(test_indexes) value
      where value ~ '^[0-9]+$'
    )
    select count(*) into locked_test_count
    from public.music_video_shots s
    join requested_indexes i on i.display_order = s.display_order
    where s.project_id = new.id
      and s.owner_id = new.owner_id
      and s.status = 'locked'
      and s.selected_asset_id is not null;

    if locked_test_count <> planned_test_count then
      raise exception 'Every representative test shot must have a locked winner before production';
    end if;
  end if;

  -- Ready-to-render means every paid source sequence is resolved to an explicit asset.
  if new.status = 'ready_to_render' then
    if exists (
      select 1
      from public.music_video_shots s
      where s.project_id = new.id
        and s.owner_id = new.owner_id
        and s.reuse_strategy in ('unique', 'continuation')
        and (s.status <> 'locked' or s.selected_asset_id is null)
    ) then
      raise exception 'All generated source shots must be locked before rendering';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists music_video_projects_stage_guard on public.music_video_projects;
create trigger music_video_projects_stage_guard
  before update of status on public.music_video_projects
  for each row execute function private.validate_music_video_project_stage_guard();
