-- One canonical media-link event owns every master-change invalidation path.
-- This replaces the transitional trigger function from the preceding migration and also handles
-- promotion of an existing non-master link to master_audio on the same Track.

create or replace function private.handle_track_master_media_link_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_is_master boolean := false;
  v_new_is_master boolean := false;
  v_change_affects_master boolean := false;
begin
  if tg_op <> 'INSERT' then
    v_old_is_master := old.role = 'master_audio' and old.track_id is not null;
  end if;
  if tg_op <> 'DELETE' then
    v_new_is_master := new.role = 'master_audio' and new.track_id is not null;
  end if;

  v_change_affects_master := case tg_op
    when 'INSERT' then v_new_is_master
    when 'DELETE' then v_old_is_master
    else
      (v_old_is_master or v_new_is_master)
      and (
        old.role is distinct from new.role
        or old.track_id is distinct from new.track_id
        or old.owner_id is distinct from new.owner_id
        or old.media_asset_id is distinct from new.media_asset_id
        or old.is_primary is distinct from new.is_primary
        or old.display_order is distinct from new.display_order
      )
  end;

  if not v_change_affects_master then
    return coalesce(new, old);
  end if;

  if v_old_is_master then
    perform private.invalidate_track_master_dependents(old.track_id, old.owner_id);
    perform private.supersede_track_moments_on_master_asset_change(old.track_id);
  end if;

  if v_new_is_master and (
    not v_old_is_master
    or old.track_id is distinct from new.track_id
    or old.owner_id is distinct from new.owner_id
  ) then
    perform private.invalidate_track_master_dependents(new.track_id, new.owner_id);
    perform private.supersede_track_moments_on_master_asset_change(new.track_id);
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function private.handle_track_master_media_link_change()
  from public, anon, authenticated;

drop trigger if exists invalidate_track_master_dependents on public.media_links;
drop trigger if exists handle_track_master_media_link_change on public.media_links;

create trigger handle_track_master_media_link_change
  after insert or update of role, track_id, owner_id, media_asset_id, is_primary, display_order or delete
  on public.media_links
  for each row execute function private.handle_track_master_media_link_change();

drop function if exists private.invalidate_track_master_from_media_link();