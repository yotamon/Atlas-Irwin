-- Campaign usage has two different lifecycle operations:
-- 1. attaching/reactivating a Moment, which requires a currently approved Moment;
-- 2. deactivating existing usage, which must remain possible when a Moment becomes historical.
-- Keeping those paths distinct lets supersession fail closed without trapping stale campaign rows.

create or replace function private.validate_campaign_moment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_campaign_owner uuid;
  v_campaign_release uuid;
  v_moment_owner uuid;
  v_moment_release uuid;
  v_moment_state public.moment_lifecycle_state;
  v_requires_current_approval boolean;
begin
  select c.owner_id, c.release_id into v_campaign_owner, v_campaign_release
  from public.campaigns c where c.id = new.campaign_id;
  if not found then raise exception 'Campaign must exist'; end if;

  select m.owner_id, m.release_id, m.state into v_moment_owner, v_moment_release, v_moment_state
  from public.moments m where m.id = new.moment_id;
  if not found then raise exception 'Campaign Moment must exist'; end if;

  if v_campaign_owner <> v_moment_owner then raise exception 'Campaign and Moment owner must match'; end if;
  if v_campaign_release is null or v_campaign_release <> v_moment_release then
    raise exception 'Campaign and Moment release must match';
  end if;
  if new.owner_id <> v_campaign_owner then raise exception 'Campaign Moment owner must match Campaign owner'; end if;

  v_requires_current_approval :=
    tg_op = 'INSERT'
    or new.is_active
    or (tg_op = 'UPDATE' and (
      new.campaign_id is distinct from old.campaign_id
      or new.moment_id is distinct from old.moment_id
      or new.owner_id is distinct from old.owner_id
    ));

  if v_requires_current_approval and v_moment_state <> 'approved' then
    raise exception 'Campaigns may only use approved Moments';
  end if;

  return new;
end;
$$;
revoke all on function private.validate_campaign_moment() from public, anon, authenticated;
