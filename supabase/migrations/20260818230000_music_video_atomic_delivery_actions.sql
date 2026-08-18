-- Atlas Video Director atomic recovery + delivery actions

create or replace function private.reenter_music_video_generation_stage() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.status <> 'planned' then
    return new;
  end if;

  if new.operation_type = 'look_image' then
    update public.music_video_projects
    set status = 'look_dev', last_error = null
    where id = new.project_id
      and owner_id = new.owner_id
      and status = 'look_review';
  elsif new.operation_type = 'test_video' then
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

create unique index if not exists media_links_primary_thumbnail_idx
  on public.media_links(release_id, role)
  where is_primary and release_id is not null and role = 'thumbnail';

create or replace function public.select_music_video_thumbnail(
  p_project_id uuid,
  p_asset_id uuid
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  p public.music_video_projects;
  a public.media_assets;
  current_metadata jsonb;
begin
  select * into p
  from public.music_video_projects
  where id = p_project_id and owner_id = auth.uid()
  for update;

  if p.id is null then raise exception 'Video project not found'; end if;
  if p.status <> 'complete' then raise exception 'Thumbnail selection requires a completed master'; end if;

  select * into a
  from public.media_assets
  where id = p_asset_id and owner_id = auth.uid()
  for update;

  if a.id is null then raise exception 'Thumbnail asset not found'; end if;
  if a.asset_type::text <> 'thumbnail' then raise exception 'Selected asset is not a thumbnail'; end if;
  if coalesce(a.metadata->>'project_id', '') <> p.id::text then
    raise exception 'Thumbnail does not belong to this video project';
  end if;

  -- Mark every candidate in this project unselected, then select exactly one.
  update public.media_assets m
  set metadata = coalesce(m.metadata, '{}'::jsonb) || jsonb_build_object(
    'selected_thumbnail', false
  )
  where m.owner_id = auth.uid()
    and m.asset_type::text = 'thumbnail'
    and m.metadata->>'project_id' = p.id::text;

  current_metadata := coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object(
    'selected_thumbnail', true,
    'selected_thumbnail_at', now()
  );
  update public.media_assets
  set metadata = current_metadata
  where id = a.id and owner_id = auth.uid();

  update public.media_links
  set is_primary = false
  where owner_id = auth.uid()
    and release_id = p.release_id
    and role::text = 'thumbnail'
    and is_primary = true;

  if exists (
    select 1 from public.media_links
    where owner_id = auth.uid()
      and release_id = p.release_id
      and media_asset_id = a.id
      and role::text = 'thumbnail'
  ) then
    update public.media_links
    set is_primary = true,
        caption = 'Selected Atlas Video Director thumbnail'
    where owner_id = auth.uid()
      and release_id = p.release_id
      and media_asset_id = a.id
      and role::text = 'thumbnail';
  else
    insert into public.media_links (
      owner_id,
      media_asset_id,
      release_id,
      track_id,
      content_item_id,
      role,
      is_primary,
      caption,
      alt_text
    ) values (
      auth.uid(),
      a.id,
      p.release_id,
      null,
      null,
      'thumbnail',
      true,
      'Selected Atlas Video Director thumbnail',
      null
    );
  end if;
end $$;

grant execute on function public.select_music_video_thumbnail(uuid, uuid) to authenticated;
