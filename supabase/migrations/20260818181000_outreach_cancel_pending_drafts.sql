create or replace function private.stop_outreach_sequence_on_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sequence_enrollment_id is not null
     and new.response_status is not null
     and lower(new.response_status) in ('replied','interested','not interested','declined','do not contact')
     and (tg_op = 'INSERT' or old.response_status is distinct from new.response_status) then

    update public.outreach_enrollments
    set status = 'stopped',
        stopped_reason = 'response:' || lower(new.response_status),
        next_run_at = null
    where id = new.sequence_enrollment_id;

    -- A draft may already have been prepared while the response was being
    -- received or logged. Never leave an unsent follow-up visible after the
    -- sequence has stopped.
    delete from public.outreach_messages m
    where m.sequence_enrollment_id = new.sequence_enrollment_id
      and m.id <> new.id
      and m.sent_at is null;
  end if;
  return new;
end;
$$;

revoke all on function private.stop_outreach_sequence_on_response() from public, anon, authenticated;
