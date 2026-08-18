-- Let existing Atlas metric writers participate in Campaign Brain without
-- forcing every SoundCloud/Spotify/manual call site to understand the new
-- marketing schema immediately.

create or replace function private.infer_metric_marketing_context()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inferred_content_id uuid;
  inferred_release_id uuid;
  inferred_campaign_id uuid;
  inferred_experiment_id uuid;
begin
  if new.content_variant_id is not null then
    select
      v.content_item_id,
      ci.release_id,
      ci.campaign_id,
      coalesce(v.experiment_id, ci.experiment_id)
    into
      inferred_content_id,
      inferred_release_id,
      inferred_campaign_id,
      inferred_experiment_id
    from public.content_variants v
    join public.content_items ci on ci.id = v.content_item_id
    where v.id = new.content_variant_id;

    new.content_item_id := coalesce(new.content_item_id, inferred_content_id);
    new.release_id := coalesce(new.release_id, inferred_release_id);
    new.campaign_id := coalesce(new.campaign_id, inferred_campaign_id);
    new.experiment_id := coalesce(new.experiment_id, inferred_experiment_id);
  end if;

  if new.content_item_id is not null
     and (new.release_id is null or new.campaign_id is null or new.experiment_id is null) then
    select ci.release_id, ci.campaign_id, ci.experiment_id
    into inferred_release_id, inferred_campaign_id, inferred_experiment_id
    from public.content_items ci
    where ci.id = new.content_item_id;

    new.release_id := coalesce(new.release_id, inferred_release_id);
    new.campaign_id := coalesce(new.campaign_id, inferred_campaign_id);
    new.experiment_id := coalesce(new.experiment_id, inferred_experiment_id);
  end if;

  if new.release_id is not null and new.campaign_id is null then
    select c.id
    into inferred_campaign_id
    from public.campaigns c
    where c.release_id = new.release_id
      and c.owner_id = new.owner_id
      and c.status in ('active','planned','paused')
    order by
      case c.status when 'active' then 0 when 'planned' then 1 else 2 end,
      c.updated_at desc
    limit 1;

    new.campaign_id := inferred_campaign_id;
  end if;

  return new;
end;
$$;

revoke all on function private.infer_metric_marketing_context() from public, anon;
grant execute on function private.infer_metric_marketing_context() to authenticated, service_role;

drop trigger if exists infer_metric_marketing_context on public.metric_snapshots;
create trigger infer_metric_marketing_context
before insert or update of release_id, content_item_id, content_variant_id, campaign_id, experiment_id
on public.metric_snapshots
for each row execute function private.infer_metric_marketing_context();
