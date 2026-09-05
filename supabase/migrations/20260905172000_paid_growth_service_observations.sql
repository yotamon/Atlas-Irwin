-- Provider workers run as service_role while artist-triggered/manual first-party sync runs as the
-- authenticated owner. The same audited RPC supports both, without opening raw observation writes.

create or replace function public.record_paid_growth_observation(
  p_experiment_id uuid,
  p_provider_reference text,
  p_impressions integer,
  p_provider_clicks integer,
  p_spend_cents integer,
  p_landing_views integer,
  p_outbound_clicks integer,
  p_pre_save_completions integer,
  p_verified boolean,
  p_verification_reference text,
  p_provider_snapshot jsonb,
  p_first_party_snapshot jsonb,
  p_observed_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_artist uuid;
  v_ceiling integer;
  v_provider text;
  v_existing uuid;
  v_id uuid;
  v_role text;
begin
  v_role := coalesce(auth.role(), '');
  if v_role = 'service_role' then
    select owner_id, artist_id, budget_ceiling_cents, provider
    into v_owner, v_artist, v_ceiling, v_provider
    from public.paid_growth_experiments
    where id=p_experiment_id
    for update;
  else
    select owner_id, artist_id, budget_ceiling_cents, provider
    into v_owner, v_artist, v_ceiling, v_provider
    from public.paid_growth_experiments
    where id=p_experiment_id and owner_id=(select auth.uid())
    for update;
  end if;

  if v_owner is null then raise exception 'Paid experiment not found'; end if;
  if v_role <> 'service_role' and not private.can_access_artist(v_artist) then raise exception 'Paid experiment not found'; end if;
  if p_spend_cents < 0 or p_spend_cents > v_ceiling then raise exception 'Observed spend exceeds the approved experiment ceiling'; end if;
  if p_verified and nullif(btrim(coalesce(p_verification_reference,'')),'') is null then raise exception 'Verified observations require a verification reference'; end if;

  if nullif(btrim(coalesce(p_provider_reference,'')),'') is not null then
    select id into v_existing from public.paid_growth_observations
    where experiment_id=p_experiment_id and provider_reference=p_provider_reference;
    if v_existing is not null then return v_existing; end if;
  end if;

  insert into public.paid_growth_observations(
    experiment_id,owner_id,artist_id,provider,provider_reference,impressions,provider_clicks,spend_cents,
    landing_views,outbound_clicks,pre_save_completions,verified,verification_reference,provider_snapshot,first_party_snapshot,observed_at
  ) values (
    p_experiment_id,v_owner,v_artist,v_provider,nullif(btrim(coalesce(p_provider_reference,'')),''),
    greatest(p_impressions,0),greatest(p_provider_clicks,0),p_spend_cents,
    greatest(p_landing_views,0),greatest(p_outbound_clicks,0),greatest(p_pre_save_completions,0),
    p_verified,nullif(btrim(coalesce(p_verification_reference,'')),''),coalesce(p_provider_snapshot,'{}'::jsonb),
    coalesce(p_first_party_snapshot,'{}'::jsonb),p_observed_at
  ) returning id into v_id;

  update public.paid_growth_experiments
  set spent_cents=greatest(spent_cents,p_spend_cents)
  where id=p_experiment_id;

  insert into public.paid_growth_events(experiment_id,owner_id,artist_id,event_type,actor_type,payload)
  values(p_experiment_id,v_owner,v_artist,'paid_growth.observation_recorded',case when v_role='service_role' then 'provider' else 'system' end,jsonb_build_object(
    'observationId',v_id,
    'verified',p_verified,
    'spendCents',p_spend_cents,
    'landingViews',greatest(p_landing_views,0),
    'outboundClicks',greatest(p_outbound_clicks,0),
    'preSaveCompletions',greatest(p_pre_save_completions,0)
  ));

  return v_id;
end;
$$;

revoke all on function public.record_paid_growth_observation(uuid,text,integer,integer,integer,integer,integer,integer,boolean,text,jsonb,jsonb,timestamptz) from public, anon;
grant execute on function public.record_paid_growth_observation(uuid,text,integer,integer,integer,integer,integer,integer,boolean,text,jsonb,jsonb,timestamptz) to authenticated, service_role;
