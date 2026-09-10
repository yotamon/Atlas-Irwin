-- Keep historical content editable after its source Moment is superseded while preventing new
-- execution from stale evidence. Active campaign usage is deactivated as soon as a Moment leaves
-- the approved state; content/performance lineage remains immutable historical evidence.

create or replace function private.validate_content_item_moment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_release_id uuid;
  v_state public.moment_lifecycle_state;
  v_start_ms integer;
  v_end_ms integer;
begin
  if new.moment_id is null then return new; end if;

  -- Existing historical lineage must not make unrelated content edits impossible. Any attempt to
  -- change owner, Release or Moment still re-enters the strict current-Moment validation below.
  if tg_op = 'UPDATE'
     and new.moment_id is not distinct from old.moment_id
     and new.owner_id is not distinct from old.owner_id
     and new.release_id is not distinct from old.release_id then
    return new;
  end if;

  select m.owner_id, m.release_id, m.state, m.start_ms, m.end_ms
    into v_owner_id, v_release_id, v_state, v_start_ms, v_end_ms
  from public.moments m where m.id = new.moment_id;
  if not found then raise exception 'Content Moment must exist'; end if;
  if v_state <> 'approved' then raise exception 'Content may only originate from an approved Moment'; end if;
  if new.owner_id <> v_owner_id then raise exception 'Content owner must match Moment owner'; end if;
  if new.release_id is null or new.release_id <> v_release_id then
    raise exception 'Content release must match Moment release';
  end if;

  if tg_op = 'INSERT' or new.moment_id is distinct from old.moment_id then
    if new.audio_timestamp_start is null then new.audio_timestamp_start := floor(v_start_ms / 1000.0)::integer; end if;
    if new.audio_timestamp_end is null then new.audio_timestamp_end := ceil(v_end_ms / 1000.0)::integer; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_content_item_moment() from public, anon, authenticated;

create or replace function private.deactivate_campaign_moment_after_lifecycle_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state = new.state or new.state = 'approved' then return new; end if;
  update public.campaign_moments
  set is_active = false, updated_at = now()
  where moment_id = new.id and is_active;
  return new;
end;
$$;
revoke all on function private.deactivate_campaign_moment_after_lifecycle_change() from public, anon, authenticated;

create trigger moments_deactivate_campaign_usage
  after update of state on public.moments
  for each row execute function private.deactivate_campaign_moment_after_lifecycle_change();
