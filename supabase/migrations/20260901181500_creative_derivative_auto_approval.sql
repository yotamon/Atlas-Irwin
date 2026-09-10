create or replace function private.finalize_creative_derivative_from_media_job()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  derivative_row public.creative_derivatives%rowtype;
  quality_passed boolean;
begin
  if new.status <> 'completed' or old.status = 'completed' or new.generation_run_id is null then
    return new;
  end if;

  select * into derivative_row
  from public.creative_derivatives d
  where d.owner_id = new.owner_id
    and d.derivative_generation_run_id = new.generation_run_id
    and d.status = 'processing'
  limit 1
  for update;

  if not found then
    return new;
  end if;

  quality_passed := coalesce(new.result_payload #>> '{visualQuality,passed}', 'false') = 'true';
  if quality_passed and derivative_row.auto_approve and derivative_row.derivative_content_item_id is not null then
    update public.content_items
      set approval_status = 'approved'
      where id = derivative_row.derivative_content_item_id
        and owner_id = derivative_row.owner_id;

    update public.creative_derivatives
      set status = 'ready', error = null
      where id = derivative_row.id;

    insert into public.marketing_events (
      owner_id, campaign_id, event_type, entity_type, entity_id, payload
    ) values (
      derivative_row.owner_id,
      derivative_row.campaign_id,
      'content.derivative_ready',
      'content_item',
      derivative_row.derivative_content_item_id,
      jsonb_build_object(
        'derivativeClaimId', derivative_row.id,
        'masterContentItemId', derivative_row.master_content_item_id,
        'masterGenerationRunId', derivative_row.master_generation_run_id,
        'derivativeGenerationRunId', derivative_row.derivative_generation_run_id,
        'targetPackageId', derivative_row.target_package_id,
        'strategy', derivative_row.strategy,
        'zeroGenerationSpend', true,
        'autoApprovedAfterQc', true
      )
    );
  elsif not quality_passed then
    update public.creative_derivatives
      set status = 'failed', error = coalesce(new.result_payload #>> '{visualQuality,summary}', 'Derivative temporal quality control did not pass.')
      where id = derivative_row.id;
  end if;

  return new;
end;
$$;

revoke all on function private.finalize_creative_derivative_from_media_job() from public, anon, authenticated;
grant execute on function private.finalize_creative_derivative_from_media_job() to service_role;

drop trigger if exists finalize_creative_derivative_from_media_job on public.marketing_media_jobs;
create trigger finalize_creative_derivative_from_media_job
  after update of status, result_payload on public.marketing_media_jobs
  for each row execute function private.finalize_creative_derivative_from_media_job();
