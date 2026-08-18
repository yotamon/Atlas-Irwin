-- Atlas Video Director look-development recovery
--
-- Look frames are exploratory references. A provider-side terminal failure/refund should not
-- dead-end the project. Return the same request to manual approval state while retaining the
-- failure reason and audit metadata. Nothing is resubmitted automatically.

create or replace function private.recover_music_video_look_generation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.operation_type = 'look_image'
    and new.status in ('failed', 'rejected_by_provider')
    and new.billing_status in ('refunded', 'not_billed') then

    update public.music_video_projects
    set status = 'look_dev',
        last_error = coalesce(new.error, 'A look-development frame failed and is ready for manual retry.')
    where id = new.project_id
      and owner_id = new.owner_id
      and status in ('look_dev', 'look_review');

    new.status := 'planned';
    new.billing_status := 'unconfirmed';
    new.actual_credits := null;
    new.approval_id := null;
    new.provider_request_id := null;
    new.submitted_at := null;
    new.completed_at := null;
  end if;

  return new;
end $$;

drop trigger if exists music_video_generations_recover_look on public.music_video_generations;
create trigger music_video_generations_recover_look
  before update of status on public.music_video_generations
  for each row execute function private.recover_music_video_look_generation();
