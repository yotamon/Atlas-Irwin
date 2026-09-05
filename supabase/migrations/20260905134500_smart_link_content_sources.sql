-- Automatically attach a stable Smart Link source code to release content.
-- This makes attribution a property of content lineage rather than an optional publishing step.

create unique index smart_link_sources_content_unique
  on public.smart_link_sources(content_item_id)
  where content_item_id is not null;

create or replace function private.ensure_content_smart_link_source(target_content_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row record;
  link_id uuid;
  source_code text;
begin
  select id, owner_id, artist_id, release_id, campaign_id, moment_id, title
    into item_row
  from public.content_items
  where id = target_content_id;

  if item_row.id is null or item_row.release_id is null or item_row.artist_id is null then
    return null;
  end if;

  link_id := private.ensure_release_smart_link(item_row.release_id);
  if link_id is null then return null; end if;

  select code into source_code
  from public.smart_link_sources
  where content_item_id = item_row.id;

  if source_code is null then
    source_code := replace(encode(gen_random_bytes(12), 'base64'), '/', '_');
    source_code := replace(source_code, '+', '-');
    source_code := replace(source_code, '=', '');
  end if;

  insert into public.smart_link_sources(
    smart_link_id, owner_id, artist_id, campaign_id, content_item_id, moment_id, code, label
  ) values (
    link_id, item_row.owner_id, item_row.artist_id, item_row.campaign_id, item_row.id, item_row.moment_id,
    source_code, coalesce(item_row.title, 'Content')
  )
  on conflict (content_item_id) where content_item_id is not null do update
    set smart_link_id = excluded.smart_link_id,
        owner_id = excluded.owner_id,
        artist_id = excluded.artist_id,
        campaign_id = excluded.campaign_id,
        moment_id = excluded.moment_id,
        label = excluded.label
  returning code into source_code;

  return source_code;
end
$$;

revoke all on function private.ensure_content_smart_link_source(uuid) from public, anon;

create or replace function private.sync_content_smart_link_source_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.release_id is not null and new.artist_id is not null then
    perform private.ensure_content_smart_link_source(new.id);
  end if;
  return new;
end
$$;

create trigger sync_content_smart_link_source
  after insert or update of release_id, artist_id, campaign_id, moment_id, title on public.content_items
  for each row execute function private.sync_content_smart_link_source_trigger();

-- Backfill current release-linked content.
do $$
declare item_row record;
begin
  for item_row in
    select id from public.content_items where release_id is not null and artist_id is not null
  loop
    perform private.ensure_content_smart_link_source(item_row.id);
  end loop;
end $$;
