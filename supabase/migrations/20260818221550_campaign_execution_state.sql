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

    update public.campaigns
    set status = 'active'
    where id = new.campaign_id
      and status in ('draft','planned');

    if new.experiment_id is not null then
      update public.campaign_experiments
      set status = 'running'
      where id = new.experiment_id
        and status = 'planned';
    end if;

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
