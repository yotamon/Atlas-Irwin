-- Make first-party attribution a canonical metric input for experiments without
-- creating an evaluation job for every redirect. Attribution clicks accumulate
-- into one daily snapshot per variant. The next reach/views metric update will
-- evaluate the experiment with those tracked clicks included.

create unique index if not exists attribution_metric_snapshot_daily_unique
  on public.metric_snapshots(
    owner_id,
    date,
    platform,
    campaign_id,
    experiment_id,
    content_variant_id,
    source
  )
  where source = 'attribution' and content_variant_id is not null;

create or replace function private.emit_metric_marketing_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Attribution redirects can be high frequency. They are already persisted in
  -- the metric model and will be included in the next evaluation triggered by
  -- platform/manual reach data, so do not enqueue one job per click.
  if new.source <> 'attribution'
     and (new.campaign_id is not null or new.experiment_id is not null or new.content_variant_id is not null) then
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

create or replace function public.record_attribution_click(
  p_code text,
  p_visitor_hash text,
  p_referrer text default null,
  p_user_agent text default null
)
returns table(destination_url text, link_id uuid, is_unique boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.attribution_links%rowtype;
  seen boolean;
  variant_experiment_id uuid;
  variant_content_item_id uuid;
  release_id_for_metric uuid;
  metric_platform public.content_platform;
begin
  select * into target
  from public.attribution_links
  where code = p_code and is_active = true
  for update;

  if target.id is null then
    return;
  end if;

  select exists(
    select 1
    from public.attribution_events e
    where e.attribution_link_id = target.id
      and e.visitor_hash = p_visitor_hash
      and e.occurred_at >= now() - interval '30 days'
  ) into seen;

  insert into public.attribution_events(
    owner_id, attribution_link_id, event_type, visitor_hash, referrer, user_agent
  ) values (
    target.owner_id, target.id, 'click', p_visitor_hash, p_referrer, p_user_agent
  );

  update public.attribution_links
  set click_count = click_count + 1,
      unique_click_count = unique_click_count + case when seen then 0 else 1 end,
      last_clicked_at = now()
  where id = target.id;

  if not seen and target.content_variant_id is not null then
    select
      v.experiment_id,
      v.content_item_id,
      ci.release_id,
      case
        when ci.platform::text in ('Instagram','TikTok','YouTube Shorts','SoundCloud','Spotify','Newsletter','Other')
          then ci.platform
        else 'Other'::public.content_platform
      end
    into variant_experiment_id, variant_content_item_id, release_id_for_metric, metric_platform
    from public.content_variants v
    join public.content_items ci on ci.id = v.content_item_id
    where v.id = target.content_variant_id;

    if variant_content_item_id is not null then
      insert into public.metric_snapshots(
        owner_id,
        date,
        platform,
        release_id,
        content_item_id,
        campaign_id,
        experiment_id,
        content_variant_id,
        source,
        captured_at,
        link_clicks,
        notes
      ) values (
        target.owner_id,
        current_date,
        coalesce(metric_platform, 'Other'::public.content_platform),
        release_id_for_metric,
        variant_content_item_id,
        target.campaign_id,
        variant_experiment_id,
        target.content_variant_id,
        'attribution',
        now(),
        1,
        'First-party unique /go click'
      )
      on conflict (
        owner_id,
        date,
        platform,
        campaign_id,
        experiment_id,
        content_variant_id,
        source
      ) where source = 'attribution' and content_variant_id is not null
      do update set
        link_clicks = public.metric_snapshots.link_clicks + 1,
        captured_at = now(),
        updated_at = now();
    end if;
  end if;

  return query select target.destination_url, target.id, not seen;
end;
$$;

revoke all on function public.record_attribution_click(text,text,text,text) from public, anon, authenticated;
grant execute on function public.record_attribution_click(text,text,text,text) to service_role;
