-- Keep the legacy /go compatibility path useful without reviving visitor identity.
-- Every redirect contributes to aggregate click metrics. We deliberately do not
-- infer or store a unique listener from visitor hashes, IPs, or user agents.
create or replace function public.record_attribution_click(
  p_code text,
  p_visitor_hash text default null,
  p_referrer text default null,
  p_user_agent text default null
)
returns table(destination_url text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.attribution_links%rowtype;
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

  insert into public.attribution_events(
    owner_id,
    artist_id,
    attribution_link_id,
    event_type,
    visitor_hash,
    referrer,
    user_agent,
    metadata,
    occurred_at
  ) values (
    target.owner_id,
    target.artist_id,
    target.id,
    'click',
    null,
    left(nullif(p_referrer, ''), 1000),
    null,
    jsonb_build_object('privacy_mode', 'sessionless'),
    now()
  );

  update public.attribution_links
  set click_count = click_count + 1,
      last_clicked_at = now(),
      updated_at = now()
  where id = target.id;

  if target.content_variant_id is not null then
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
        artist_id,
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
        target.artist_id,
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
        'First-party sessionless /go click'
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

  return query select target.destination_url;
end;
$$;

revoke all on function public.record_attribution_click(text,text,text,text) from public, anon, authenticated;
grant execute on function public.record_attribution_click(text,text,text,text) to service_role;
