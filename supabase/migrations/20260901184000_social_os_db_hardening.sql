-- Social OS release hardening.
-- Campaign AI spend RPCs are server-only. The internal actor checks remain defense in depth,
-- but authenticated browser clients do not need direct PostgREST EXECUTE access.
revoke execute on function public.reserve_campaign_ai_spend(uuid,uuid,uuid,text,numeric) from authenticated;
revoke execute on function public.settle_campaign_ai_spend(uuid,uuid,numeric,text) from authenticated;
revoke execute on function public.release_campaign_ai_spend(uuid,uuid,text) from authenticated;

grant execute on function public.reserve_campaign_ai_spend(uuid,uuid,uuid,text,numeric) to service_role;
grant execute on function public.settle_campaign_ai_spend(uuid,uuid,numeric,text) to service_role;
grant execute on function public.release_campaign_ai_spend(uuid,uuid,text) to service_role;

-- Cover every foreign key introduced by the Social OS migrations with an index whose leading
-- column is the referenced FK. Existing owner-scoped compound indexes are kept for application
-- queries; these indexes protect FK maintenance and cascade/delete performance.
create index if not exists marketing_media_jobs_campaign_id_idx
  on public.marketing_media_jobs(campaign_id)
  where campaign_id is not null;
create index if not exists marketing_media_jobs_release_id_idx
  on public.marketing_media_jobs(release_id)
  where release_id is not null;
create index if not exists marketing_media_jobs_content_item_id_idx
  on public.marketing_media_jobs(content_item_id);
create index if not exists marketing_media_jobs_generation_run_id_idx
  on public.marketing_media_jobs(generation_run_id)
  where generation_run_id is not null;

create index if not exists creative_derivatives_campaign_id_idx
  on public.creative_derivatives(campaign_id)
  where campaign_id is not null;
create index if not exists creative_derivatives_master_content_item_id_idx
  on public.creative_derivatives(master_content_item_id);
create index if not exists creative_derivatives_derivative_content_item_id_idx
  on public.creative_derivatives(derivative_content_item_id)
  where derivative_content_item_id is not null;
create index if not exists creative_derivatives_master_generation_run_id_idx
  on public.creative_derivatives(master_generation_run_id);
create index if not exists creative_derivatives_derivative_generation_run_id_idx
  on public.creative_derivatives(derivative_generation_run_id)
  where derivative_generation_run_id is not null;

create index if not exists campaign_ai_spend_envelopes_campaign_id_idx
  on public.campaign_ai_spend_envelopes(campaign_id);
create index if not exists campaign_ai_spend_reservations_campaign_id_idx
  on public.campaign_ai_spend_reservations(campaign_id);
create index if not exists campaign_ai_spend_reservations_generation_run_id_idx
  on public.campaign_ai_spend_reservations(generation_run_id);
