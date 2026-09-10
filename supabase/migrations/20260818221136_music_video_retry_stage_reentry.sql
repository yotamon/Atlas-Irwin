-- Atlas Video Director manual retry stage re-entry
--
-- Creating a new planned generation from a review screen must reopen the matching
-- generation stage. This keeps recovery valid even when actions are called directly.

create or replace function private.reenter_music_video_generation_stage() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.status <> 'planned' then
    return new;
  end if;

  if new.operation_type = 'test_video' then
    update public.music_video_projects
    set status = 'test_generation', last_error = null
    where id = new.project_id
      and owner_id = new.owner_id
      and status = 'test_review';
  elsif new.operation_type = 'shot_video' then
    update public.music_video_projects
    set status = 'production', last_error = null
    where id = new.project_id
      and owner_id = new.owner_id
      and status = 'shot_review';
  end if;

  return new;
end $$;

drop trigger if exists music_video_generations_reenter_stage on public.music_video_generations;
create trigger music_video_generations_reenter_stage
  after insert on public.music_video_generations
  for each row execute function private.reenter_music_video_generation_stage();
