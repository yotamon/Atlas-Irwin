-- Atlas Video Director generation-stage reconciliation
--
-- Provider callbacks are at-least-once. Keep shot/project stage effects in the same
-- transaction as the generation status change so a partial callback cannot leave a
-- terminal generation with unreconciled production state.

create or replace function private.reconcile_music_video_generation_stage() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  pending_count integer;
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'completed' then
    if new.shot_id is not null then
      update public.music_video_shots
      set status = 'review'
      where id = new.shot_id
        and project_id = new.project_id
        and owner_id = new.owner_id
        and status not in ('locked', 'omitted');
    end if;

    if new.operation_type = 'look_image' then
      select count(*) into pending_count
      from public.music_video_generations g
      where g.project_id = new.project_id
        and g.owner_id = new.owner_id
        and g.operation_type = 'look_image'
        and g.id <> new.id
        and g.status in ('planned', 'approved', 'submitted', 'queued', 'in_progress');
      if pending_count = 0 then
        update public.music_video_projects
        set status = 'look_review', last_error = null
        where id = new.project_id and owner_id = new.owner_id and status = 'look_dev';
      end if;
    elsif new.operation_type = 'test_video' then
      select count(*) into pending_count
      from public.music_video_generations g
      where g.project_id = new.project_id
        and g.owner_id = new.owner_id
        and g.operation_type = 'test_video'
        and g.id <> new.id
        and g.status in ('planned', 'approved', 'submitted', 'queued', 'in_progress');
      if pending_count = 0 then
        update public.music_video_projects
        set status = 'test_review', last_error = null
        where id = new.project_id and owner_id = new.owner_id and status = 'test_generation';
      end if;
    elsif new.operation_type = 'shot_video' then
      select count(*) into pending_count
      from public.music_video_generations g
      where g.project_id = new.project_id
        and g.owner_id = new.owner_id
        and g.operation_type = 'shot_video'
        and g.id <> new.id
        and g.status in ('planned', 'approved', 'submitted', 'queued', 'in_progress');
      if pending_count = 0 then
        update public.music_video_projects
        set status = 'shot_review', last_error = null
        where id = new.project_id and owner_id = new.owner_id and status = 'production';
      end if;
    end if;
  elsif new.status in ('failed', 'rejected_by_provider') and new.shot_id is not null then
    update public.music_video_shots
    set status = 'failed'
    where id = new.shot_id
      and project_id = new.project_id
      and owner_id = new.owner_id
      and status not in ('locked', 'omitted');
  end if;

  return new;
end $$;

drop trigger if exists music_video_generations_reconcile_stage on public.music_video_generations;
create trigger music_video_generations_reconcile_stage
  after update of status on public.music_video_generations
  for each row execute function private.reconcile_music_video_generation_stage();
