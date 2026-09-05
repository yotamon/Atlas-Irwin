-- Once an artist approves a paid experiment, its hypothesis, lineage, target, success contract and
-- hard budget become immutable. Runtime state/spend/provider fields may still change.

create or replace function private.lock_approved_paid_growth_contract()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.approval_status = 'approved' and (
    new.release_id is distinct from old.release_id
    or new.campaign_id is distinct from old.campaign_id
    or new.moment_id is distinct from old.moment_id
    or new.content_item_id is distinct from old.content_item_id
    or new.smart_link_id is distinct from old.smart_link_id
    or new.smart_link_source_id is distinct from old.smart_link_source_id
    or new.title is distinct from old.title
    or new.hypothesis is distinct from old.hypothesis
    or new.evidence is distinct from old.evidence
    or new.evidence_strength is distinct from old.evidence_strength
    or new.provider is distinct from old.provider
    or new.platform is distinct from old.platform
    or new.objective is distinct from old.objective
    or new.audience is distinct from old.audience
    or new.geo_countries is distinct from old.geo_countries
    or new.currency is distinct from old.currency
    or new.budget_ceiling_cents is distinct from old.budget_ceiling_cents
    or new.daily_budget_cents is distinct from old.daily_budget_cents
    or new.minimum_sample is distinct from old.minimum_sample
    or new.success_metric is distinct from old.success_metric
    or new.success_threshold is distinct from old.success_threshold
    or new.stop_conditions is distinct from old.stop_conditions
    or new.idempotency_key is distinct from old.idempotency_key
  ) then
    raise exception 'Approved paid experiment contract is immutable. Stop it and create a new experiment instead.';
  end if;
  return new;
end;
$$;
revoke all on function private.lock_approved_paid_growth_contract() from public, anon, authenticated;

create trigger paid_growth_contract_lock
  before update on public.paid_growth_experiments
  for each row execute function private.lock_approved_paid_growth_contract();

comment on function private.lock_approved_paid_growth_contract() is
  'Prevents changing an artist-approved paid test contract in place. A changed hypothesis/budget/creative/destination must be a new experiment.';
