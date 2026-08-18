create or replace function private.emit_metric_marketing_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.campaign_id is not null or new.experiment_id is not null or new.content_variant_id is not null then
    insert into public.marketing_events(
      owner_id, campaign_id, event_type, entity_type, entity_id, payload, occurred_at
    ) values (
      new.owner_id,
      new.campaign_id,
      'metrics.updated',
      'metric_snapshot',
      new.id,
      jsonb_build_object(
        'experimentId', new.experiment_id,
        'contentItemId', new.content_item_id,
        'contentVariantId', new.content_variant_id,
        'platform', new.platform,
        'source', new.source
      ),
      coalesce(new.captured_at, now())
    );
  end if;
  return new;
end;
$$;

revoke all on function private.emit_metric_marketing_event() from public, anon, authenticated;

drop trigger if exists emit_metric_marketing_event on public.metric_snapshots;
create trigger emit_metric_marketing_event
after insert or update on public.metric_snapshots
for each row execute function private.emit_metric_marketing_event();

create or replace function private.emit_content_published_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.campaign_id is not null
     and new.status = 'Published'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.marketing_events(
      owner_id, campaign_id, event_type, entity_type, entity_id, payload, occurred_at
    ) values (
      new.owner_id,
      new.campaign_id,
      'content.published',
      'content_item',
      new.id,
      jsonb_build_object(
        'platform', new.platform,
        'experimentId', new.experiment_id,
        'publishedAt', coalesce(new.published_at, now())
      ),
      coalesce(new.published_at, now())
    );
  end if;
  return new;
end;
$$;

revoke all on function private.emit_content_published_event() from public, anon, authenticated;

drop trigger if exists emit_content_published_event on public.content_items;
create trigger emit_content_published_event
after insert or update of status on public.content_items
for each row execute function private.emit_content_published_event();
