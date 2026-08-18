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
  end if;
  return new;
end;
$$;

revoke all on function private.stop_outreach_sequence_on_response() from public, anon, authenticated;

drop trigger if exists stop_outreach_sequence_on_response on public.outreach_messages;
create trigger stop_outreach_sequence_on_response
after insert or update on public.outreach_messages
for each row execute function private.stop_outreach_sequence_on_response();
