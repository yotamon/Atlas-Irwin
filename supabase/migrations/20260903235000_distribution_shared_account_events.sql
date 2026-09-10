-- Distribution provider accounts are workspace/account-level, so account-only audit events do not
-- pretend to belong to one artist. Release/submission events remain strictly artist-scoped.

alter table public.distribution_events alter column artist_id drop not null;

drop trigger if exists distribution_events_validate_artist_scope on public.distribution_events;

create or replace function private.validate_distribution_event_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected uuid;
  linked uuid;
begin
  expected := new.artist_id;

  if new.release_id is not null then
    select artist_id into linked from public.releases where id = new.release_id;
    expected := coalesce(expected, linked);
    if linked is null or expected <> linked then
      raise exception 'Distribution event artist must match release artist';
    end if;
  end if;

  if new.submission_id is not null then
    select artist_id into linked from public.distribution_submissions where id = new.submission_id;
    expected := coalesce(expected, linked);
    if linked is null or expected <> linked then
      raise exception 'Distribution event artist must match submission artist';
    end if;
  end if;

  -- An account-only event is intentionally workspace-level. If an artist is supplied, validate it;
  -- otherwise keep artist_id null rather than arbitrarily selecting one sibling artist.
  if expected is not null then
    perform private.assert_operational_artist_owner(new.owner_id, expected);
  end if;

  new.artist_id := expected;
  return new;
end;
$$;
revoke all on function private.validate_distribution_event_scope() from public, anon, authenticated;

create trigger distribution_events_validate_artist_scope
  before insert or update on public.distribution_events
  for each row execute function private.validate_distribution_event_scope();

comment on column public.distribution_events.artist_id is
  'Canonical artist for release/submission events; null only for intentionally shared distribution-account events.';
