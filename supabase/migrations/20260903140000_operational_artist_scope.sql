-- Ensemblis #71: make marketing, growth, audience and external-effect execution explicitly artist-scoped.
--
-- owner_id remains an authentication/compatibility field during the cutover. artist_id is the
-- canonical music/product identity. Existing Atlas rows are backfilled only through canonical
-- release/campaign/content lineage or the deterministic legacy artist mapping created by #70.

-- ---------------------------------------------------------------------------
-- 1. Add artist scope to durable operational state.
-- ---------------------------------------------------------------------------

alter table public.tasks add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.brand_settings add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.release_learnings add column if not exists artist_id uuid references public.artists(id) on delete restrict;

alter table public.campaigns add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.campaign_phases add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.campaign_experiments add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.campaign_moments add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.generation_runs add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.content_items add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.content_variants add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.publication_jobs add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.attribution_links add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.attribution_events add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.marketing_events add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.automation_jobs add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.marketing_learnings add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.metric_snapshots add column if not exists artist_id uuid references public.artists(id) on delete restrict;

alter table public.outreach_contacts add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.outreach_sequences add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.outreach_sequence_steps add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.outreach_enrollments add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.outreach_messages add column if not exists artist_id uuid references public.artists(id) on delete restrict;

alter table public.artist_growth_settings add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.track_vault add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.growth_plan_items add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.growth_opportunities add column if not exists artist_id uuid references public.artists(id) on delete restrict;

alter table public.audience_interactions add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.marketing_opportunities add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.next_best_actions add column if not exists artist_id uuid references public.artists(id) on delete restrict;

alter table public.social_channel_accounts add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table private.social_channel_tokens add column if not exists artist_id uuid references public.artists(id) on delete restrict;

alter table public.marketing_media_jobs add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.creative_derivatives add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.campaign_ai_spend_envelopes add column if not exists artist_id uuid references public.artists(id) on delete restrict;
alter table public.campaign_ai_spend_reservations add column if not exists artist_id uuid references public.artists(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 2. Parent-first backfill. Never infer from another arbitrary row owned by the user.
-- ---------------------------------------------------------------------------

update public.campaigns c
set artist_id = coalesce(r.artist_id, private.legacy_artist_for_owner(c.owner_id))
from public.releases r
where r.id = c.release_id and c.artist_id is null;
update public.campaigns c
set artist_id = private.legacy_artist_for_owner(c.owner_id)
where c.artist_id is null;

update public.content_items ci
set artist_id = coalesce(r.artist_id, c.artist_id, m.artist_id, private.legacy_artist_for_owner(ci.owner_id))
from public.releases r
full join public.campaigns c on false
full join public.moments m on false
where ci.artist_id is null
  and r.id is not distinct from ci.release_id
  and c.id is not distinct from ci.campaign_id
  and m.id is not distinct from ci.moment_id;
-- The full-join form above intentionally handles rows with all optional lineage null. Re-run with
-- correlated lookups for PostgreSQL planners that prune null optional parents aggressively.
update public.content_items ci
set artist_id = coalesce(
  (select r.artist_id from public.releases r where r.id = ci.release_id),
  (select c.artist_id from public.campaigns c where c.id = ci.campaign_id),
  (select m.artist_id from public.moments m where m.id = ci.moment_id),
  private.legacy_artist_for_owner(ci.owner_id)
)
where ci.artist_id is null;

update public.tasks t
set artist_id = coalesce((select r.artist_id from public.releases r where r.id=t.release_id), private.legacy_artist_for_owner(t.owner_id))
where t.artist_id is null;
update public.brand_settings b set artist_id=private.legacy_artist_for_owner(b.owner_id) where b.artist_id is null;
update public.release_learnings l
set artist_id=coalesce((select r.artist_id from public.releases r where r.id=l.release_id), private.legacy_artist_for_owner(l.owner_id))
where l.artist_id is null;

update public.campaign_phases x set artist_id=c.artist_id from public.campaigns c where c.id=x.campaign_id and x.artist_id is null;
update public.campaign_experiments x set artist_id=c.artist_id from public.campaigns c where c.id=x.campaign_id and x.artist_id is null;
update public.campaign_moments x set artist_id=c.artist_id from public.campaigns c where c.id=x.campaign_id and x.artist_id is null;
update public.generation_runs x
set artist_id=coalesce((select c.artist_id from public.campaigns c where c.id=x.campaign_id),(select r.artist_id from public.releases r where r.id=x.release_id),private.legacy_artist_for_owner(x.owner_id))
where x.artist_id is null;
update public.content_variants x set artist_id=ci.artist_id from public.content_items ci where ci.id=x.content_item_id and x.artist_id is null;
update public.publication_jobs x
set artist_id=coalesce((select ci.artist_id from public.content_items ci where ci.id=x.content_item_id),(select c.artist_id from public.campaigns c where c.id=x.campaign_id),private.legacy_artist_for_owner(x.owner_id))
where x.artist_id is null;
update public.attribution_links x set artist_id=c.artist_id from public.campaigns c where c.id=x.campaign_id and x.artist_id is null;
update public.attribution_events x set artist_id=l.artist_id from public.attribution_links l where l.id=x.attribution_link_id and x.artist_id is null;
update public.marketing_events x
set artist_id=coalesce((select c.artist_id from public.campaigns c where c.id=x.campaign_id),private.legacy_artist_for_owner(x.owner_id))
where x.artist_id is null;
update public.automation_jobs x
set artist_id=coalesce((select c.artist_id from public.campaigns c where c.id=x.campaign_id),(select e.artist_id from public.marketing_events e where e.id=x.source_event_id),private.legacy_artist_for_owner(x.owner_id))
where x.artist_id is null;
update public.marketing_learnings x
set artist_id=coalesce((select c.artist_id from public.campaigns c where c.id=x.campaign_id),(select r.artist_id from public.releases r where r.id=x.release_id),private.legacy_artist_for_owner(x.owner_id))
where x.artist_id is null;
update public.metric_snapshots x
set artist_id=coalesce((select ci.artist_id from public.content_items ci where ci.id=x.content_item_id),(select c.artist_id from public.campaigns c where c.id=x.campaign_id),(select r.artist_id from public.releases r where r.id=x.release_id),private.legacy_artist_for_owner(x.owner_id))
where x.artist_id is null;

update public.outreach_contacts x set artist_id=private.legacy_artist_for_owner(x.owner_id) where x.artist_id is null;
update public.outreach_sequences x
set artist_id=coalesce((select c.artist_id from public.campaigns c where c.id=x.campaign_id),private.legacy_artist_for_owner(x.owner_id))
where x.artist_id is null;
update public.outreach_sequence_steps x set artist_id=s.artist_id from public.outreach_sequences s where s.id=x.sequence_id and x.artist_id is null;
update public.outreach_enrollments x set artist_id=s.artist_id from public.outreach_sequences s where s.id=x.sequence_id and x.artist_id is null;
update public.outreach_messages x
set artist_id=coalesce((select e.artist_id from public.outreach_enrollments e where e.id=x.sequence_enrollment_id),(select c.artist_id from public.campaigns c where c.id=x.campaign_id),(select r.artist_id from public.releases r where r.id=x.release_id),(select oc.artist_id from public.outreach_contacts oc where oc.id=x.contact_id),private.legacy_artist_for_owner(x.owner_id))
where x.artist_id is null;

update public.artist_growth_settings x set artist_id=private.legacy_artist_for_owner(x.owner_id) where x.artist_id is null;
update public.track_vault x
set artist_id=coalesce((select r.artist_id from public.releases r where r.id=x.linked_release_id),private.legacy_artist_for_owner(x.owner_id))
where x.artist_id is null;
update public.growth_plan_items x
set artist_id=coalesce((select v.artist_id from public.track_vault v where v.id=x.track_vault_id),(select r.artist_id from public.releases r where r.id=x.release_id),private.legacy_artist_for_owner(x.owner_id))
where x.artist_id is null;
update public.growth_opportunities x
set artist_id=coalesce((select ci.artist_id from public.content_items ci where ci.id=x.content_item_id),(select v.artist_id from public.track_vault v where v.id=x.track_vault_id),(select r.artist_id from public.releases r where r.id=x.release_id),private.legacy_artist_for_owner(x.owner_id))
where x.artist_id is null;

update public.audience_interactions x set artist_id=private.legacy_artist_for_owner(x.owner_id) where x.artist_id is null;
update public.marketing_opportunities x set artist_id=private.legacy_artist_for_owner(x.owner_id) where x.artist_id is null;
update public.next_best_actions x set artist_id=private.legacy_artist_for_owner(x.owner_id) where x.artist_id is null;
update public.social_channel_accounts x set artist_id=private.legacy_artist_for_owner(x.owner_id) where x.artist_id is null;
update private.social_channel_tokens x set artist_id=private.legacy_artist_for_owner(x.owner_id) where x.artist_id is null;

update public.marketing_media_jobs x
set artist_id=coalesce((select ci.artist_id from public.content_items ci where ci.id=x.content_item_id),(select c.artist_id from public.campaigns c where c.id=x.campaign_id),(select r.artist_id from public.releases r where r.id=x.release_id),private.legacy_artist_for_owner(x.owner_id))
where x.artist_id is null;
update public.creative_derivatives x
set artist_id=coalesce((select ci.artist_id from public.content_items ci where ci.id=x.master_content_item_id),(select c.artist_id from public.campaigns c where c.id=x.campaign_id),private.legacy_artist_for_owner(x.owner_id))
where x.artist_id is null;
update public.campaign_ai_spend_envelopes x set artist_id=c.artist_id from public.campaigns c where c.id=x.campaign_id and x.artist_id is null;
update public.campaign_ai_spend_reservations x set artist_id=c.artist_id from public.campaigns c where c.id=x.campaign_id and x.artist_id is null;

-- Fail the migration rather than silently leaving unscoped operational history.
do $$
declare
  t text;
  missing_count bigint;
begin
  foreach t in array array[
    'tasks','brand_settings','release_learnings','campaigns','campaign_phases','campaign_experiments','campaign_moments',
    'generation_runs','content_items','content_variants','publication_jobs','attribution_links','attribution_events',
    'marketing_events','automation_jobs','marketing_learnings','metric_snapshots','outreach_contacts','outreach_sequences',
    'outreach_sequence_steps','outreach_enrollments','outreach_messages','artist_growth_settings','track_vault','growth_plan_items',
    'growth_opportunities','audience_interactions','marketing_opportunities','next_best_actions','social_channel_accounts',
    'marketing_media_jobs','creative_derivatives','campaign_ai_spend_envelopes','campaign_ai_spend_reservations'
  ] loop
    execute format('select count(*) from public.%I where artist_id is null', t) into missing_count;
    if missing_count > 0 then raise exception 'Ensemblis operational artist backfill failed for % (% rows)', t, missing_count; end if;
  end loop;
  select count(*) into missing_count from private.social_channel_tokens where artist_id is null;
  if missing_count > 0 then raise exception 'Ensemblis operational artist backfill failed for private.social_channel_tokens (% rows)', missing_count; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Canonical lineage guard. Runs for authenticated callers and service-role workers.
-- ---------------------------------------------------------------------------

create or replace function private.assert_operational_artist_owner(p_owner_id uuid, p_artist_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_artist_id is null then raise exception 'artist_id is required for operational state'; end if;
  if not private.profile_can_manage_artist(p_owner_id, p_artist_id) then
    raise exception 'Operational owner must be an active member of the artist workspace';
  end if;
end;
$$;
revoke all on function private.assert_operational_artist_owner(uuid,uuid) from public, anon, authenticated;

create or replace function private.validate_operational_artist_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected uuid;
  linked uuid;
  payload_artist text;
begin
  expected := new.artist_id;

  if tg_table_name = 'campaigns' then
    if new.release_id is not null then select artist_id into linked from public.releases where id=new.release_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Campaign artist must match release artist'; end if; end if;
  elsif tg_table_name in ('campaign_phases','campaign_experiments','campaign_moments','campaign_ai_spend_envelopes','campaign_ai_spend_reservations') then
    select artist_id into linked from public.campaigns where id=new.campaign_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception '% artist must match campaign artist', tg_table_name; end if;
  elsif tg_table_name = 'content_items' then
    if new.release_id is not null then select artist_id into linked from public.releases where id=new.release_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Content artist must match release artist'; end if; end if;
    if new.campaign_id is not null then select artist_id into linked from public.campaigns where id=new.campaign_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Content artist must match campaign artist'; end if; end if;
    if new.moment_id is not null then select artist_id into linked from public.moments where id=new.moment_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Content artist must match Moment artist'; end if; end if;
  elsif tg_table_name = 'content_variants' then
    select artist_id into linked from public.content_items where id=new.content_item_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Content variant artist must match content artist'; end if;
  elsif tg_table_name = 'generation_runs' then
    if new.campaign_id is not null then select artist_id into linked from public.campaigns where id=new.campaign_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Generation run artist must match campaign artist'; end if; end if;
    if new.release_id is not null then select artist_id into linked from public.releases where id=new.release_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Generation run artist must match release artist'; end if; end if;
  elsif tg_table_name = 'publication_jobs' then
    if new.content_item_id is not null then select artist_id into linked from public.content_items where id=new.content_item_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Publication artist must match content artist'; end if; end if;
    if new.campaign_id is not null then select artist_id into linked from public.campaigns where id=new.campaign_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Publication artist must match campaign artist'; end if; end if;
    payload_artist := nullif(new.request_payload->>'artistId','');
    if payload_artist is not null and payload_artist::uuid<>expected then raise exception 'Publication payload artist must match publication artist'; end if;
    new.request_payload := coalesce(new.request_payload,'{}'::jsonb) || jsonb_build_object('artistId',expected);
  elsif tg_table_name = 'automation_jobs' then
    if new.campaign_id is not null then select artist_id into linked from public.campaigns where id=new.campaign_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Automation job artist must match campaign artist'; end if; end if;
    if new.source_event_id is not null then select artist_id into linked from public.marketing_events where id=new.source_event_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Automation job artist must match source event artist'; end if; end if;
    payload_artist := nullif(new.payload->>'artistId','');
    if payload_artist is not null and payload_artist::uuid<>expected then raise exception 'Automation payload artist must match job artist'; end if;
    new.payload := coalesce(new.payload,'{}'::jsonb) || jsonb_build_object('artistId',expected);
  elsif tg_table_name = 'marketing_media_jobs' then
    select artist_id into linked from public.content_items where id=new.content_item_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Media job artist must match content artist'; end if;
    payload_artist := nullif(new.request_payload->>'artistId','');
    if payload_artist is not null and payload_artist::uuid<>expected then raise exception 'Media job payload artist must match job artist'; end if;
    new.request_payload := coalesce(new.request_payload,'{}'::jsonb) || jsonb_build_object('artistId',expected);
  elsif tg_table_name = 'creative_derivatives' then
    select artist_id into linked from public.content_items where id=new.master_content_item_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Creative derivative artist must match master content artist'; end if;
    if new.derivative_content_item_id is not null then select artist_id into linked from public.content_items where id=new.derivative_content_item_id; if linked is null or expected<>linked then raise exception 'Creative derivative output must stay inside master artist'; end if; end if;
  elsif tg_table_name = 'attribution_links' then
    select artist_id into linked from public.campaigns where id=new.campaign_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Attribution link artist must match campaign artist'; end if;
  elsif tg_table_name = 'attribution_events' then
    select artist_id into linked from public.attribution_links where id=new.attribution_link_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Attribution event artist must match attribution link artist'; end if;
  elsif tg_table_name = 'marketing_events' then
    if new.campaign_id is not null then select artist_id into linked from public.campaigns where id=new.campaign_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Marketing event artist must match campaign artist'; end if; end if;
  elsif tg_table_name = 'marketing_learnings' then
    if new.campaign_id is not null then select artist_id into linked from public.campaigns where id=new.campaign_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Marketing learning artist must match campaign artist'; end if; end if;
    if new.release_id is not null then select artist_id into linked from public.releases where id=new.release_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Marketing learning artist must match release artist'; end if; end if;
  elsif tg_table_name = 'metric_snapshots' then
    if new.content_item_id is not null then select artist_id into linked from public.content_items where id=new.content_item_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Metric artist must match content artist'; end if; end if;
    if new.campaign_id is not null then select artist_id into linked from public.campaigns where id=new.campaign_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Metric artist must match campaign artist'; end if; end if;
    if new.release_id is not null then select artist_id into linked from public.releases where id=new.release_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Metric artist must match release artist'; end if; end if;
  elsif tg_table_name = 'tasks' then
    if new.release_id is not null then select artist_id into linked from public.releases where id=new.release_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Task artist must match release artist'; end if; end if;
  elsif tg_table_name = 'release_learnings' then
    if new.release_id is not null then select artist_id into linked from public.releases where id=new.release_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Release learning artist must match release artist'; end if; end if;
  elsif tg_table_name = 'outreach_sequence_steps' then
    select artist_id into linked from public.outreach_sequences where id=new.sequence_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Outreach step artist must match sequence artist'; end if;
  elsif tg_table_name = 'outreach_enrollments' then
    select artist_id into linked from public.outreach_sequences where id=new.sequence_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Outreach enrollment artist must match sequence artist'; end if;
    select artist_id into linked from public.outreach_contacts where id=new.contact_id; if linked is null or expected<>linked then raise exception 'Outreach enrollment contact must belong to sequence artist'; end if;
  elsif tg_table_name = 'outreach_messages' then
    select artist_id into linked from public.outreach_contacts where id=new.contact_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Outreach message contact must belong to message artist'; end if;
    if new.release_id is not null then select artist_id into linked from public.releases where id=new.release_id; if linked is null or expected<>linked then raise exception 'Outreach message release must belong to message artist'; end if; end if;
    if new.campaign_id is not null then select artist_id into linked from public.campaigns where id=new.campaign_id; if linked is null or expected<>linked then raise exception 'Outreach message campaign must belong to message artist'; end if; end if;
  elsif tg_table_name = 'track_vault' then
    if new.linked_release_id is not null then select artist_id into linked from public.releases where id=new.linked_release_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Vault track artist must match linked release artist'; end if; end if;
  elsif tg_table_name = 'growth_plan_items' then
    if new.track_vault_id is not null then select artist_id into linked from public.track_vault where id=new.track_vault_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Growth plan artist must match vault track artist'; end if; end if;
    if new.release_id is not null then select artist_id into linked from public.releases where id=new.release_id; if linked is null or expected<>linked then raise exception 'Growth plan release must belong to plan artist'; end if; end if;
  elsif tg_table_name = 'growth_opportunities' then
    if new.track_vault_id is not null then select artist_id into linked from public.track_vault where id=new.track_vault_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Growth opportunity vault track must belong to opportunity artist'; end if; end if;
    if new.content_item_id is not null then select artist_id into linked from public.content_items where id=new.content_item_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Growth opportunity content must belong to opportunity artist'; end if; end if;
    if new.release_id is not null then select artist_id into linked from public.releases where id=new.release_id; expected:=coalesce(expected,linked); if linked is null or expected<>linked then raise exception 'Growth opportunity release must belong to opportunity artist'; end if; end if;
  end if;

  if expected is null then expected := private.legacy_artist_for_owner(new.owner_id); end if;
  perform private.assert_operational_artist_owner(new.owner_id, expected);
  new.artist_id := expected;
  return new;
end;
$$;
revoke all on function private.validate_operational_artist_scope() from public, anon, authenticated;

-- All public operational tables share the same service-role-safe lineage guard.
do $$
declare t text;
begin
  foreach t in array array[
    'tasks','brand_settings','release_learnings','campaigns','campaign_phases','campaign_experiments','campaign_moments','generation_runs',
    'content_items','content_variants','publication_jobs','attribution_links','attribution_events','marketing_events','automation_jobs',
    'marketing_learnings','metric_snapshots','outreach_contacts','outreach_sequences','outreach_sequence_steps','outreach_enrollments',
    'outreach_messages','artist_growth_settings','track_vault','growth_plan_items','growth_opportunities','audience_interactions',
    'marketing_opportunities','next_best_actions','social_channel_accounts','marketing_media_jobs','creative_derivatives',
    'campaign_ai_spend_envelopes','campaign_ai_spend_reservations'
  ] loop
    execute format('drop trigger if exists %1$I_validate_operational_artist on public.%1$I',t);
    execute format('create trigger %1$I_validate_operational_artist before insert or update on public.%1$I for each row execute function private.validate_operational_artist_scope()',t);
  end loop;
end $$;

create or replace function private.validate_social_token_artist_scope()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.artist_id is null then new.artist_id:=private.legacy_artist_for_owner(new.owner_id); end if;
  perform private.assert_operational_artist_owner(new.owner_id,new.artist_id);
  return new;
end $$;
revoke all on function private.validate_social_token_artist_scope() from public,anon,authenticated;
drop trigger if exists social_channel_tokens_validate_operational_artist on private.social_channel_tokens;
create trigger social_channel_tokens_validate_operational_artist before insert or update on private.social_channel_tokens for each row execute function private.validate_social_token_artist_scope();

-- ---------------------------------------------------------------------------
-- 4. artist_id is durable and uniqueness is artist-local where identities may repeat.
-- ---------------------------------------------------------------------------

do $$ declare t text; begin
  foreach t in array array[
    'tasks','brand_settings','release_learnings','campaigns','campaign_phases','campaign_experiments','campaign_moments','generation_runs',
    'content_items','content_variants','publication_jobs','attribution_links','attribution_events','marketing_events','automation_jobs',
    'marketing_learnings','metric_snapshots','outreach_contacts','outreach_sequences','outreach_sequence_steps','outreach_enrollments',
    'outreach_messages','artist_growth_settings','track_vault','growth_plan_items','growth_opportunities','audience_interactions',
    'marketing_opportunities','next_best_actions','social_channel_accounts','marketing_media_jobs','creative_derivatives',
    'campaign_ai_spend_envelopes','campaign_ai_spend_reservations'
  ] loop execute format('alter table public.%I alter column artist_id set not null',t); end loop;
end $$;
alter table private.social_channel_tokens alter column artist_id set not null;

-- Settings/connections are one row per artist, not one row per login profile.
alter table public.artist_growth_settings drop constraint if exists artist_growth_settings_pkey;
alter table public.artist_growth_settings add constraint artist_growth_settings_pkey primary key (artist_id);
alter table public.social_channel_accounts drop constraint if exists social_channel_accounts_pkey;
alter table public.social_channel_accounts add constraint social_channel_accounts_pkey primary key (artist_id,platform);
alter table private.social_channel_tokens drop constraint if exists social_channel_tokens_pkey;
alter table private.social_channel_tokens add constraint social_channel_tokens_pkey primary key (artist_id,platform);

-- Remove owner-local uniqueness that would incorrectly couple sibling artists.
do $$
declare r record;
begin
  for r in select conrelid::regclass as tbl, conname from pg_constraint where contype='u' and (
    (conrelid='public.growth_opportunities'::regclass and pg_get_constraintdef(oid) ilike '%owner_id, dedupe_key%') or
    (conrelid='public.audience_interactions'::regclass and pg_get_constraintdef(oid) ilike '%owner_id, platform, external_interaction_id%') or
    (conrelid='public.marketing_opportunities'::regclass and pg_get_constraintdef(oid) ilike '%owner_id, source, external_key%') or
    (conrelid='public.next_best_actions'::regclass and pg_get_constraintdef(oid) ilike '%owner_id, idempotency_key%') or
    (conrelid='public.creative_derivatives'::regclass and pg_get_constraintdef(oid) ilike '%owner_id, master_content_item_id, target_package_id%')
  ) loop execute format('alter table %s drop constraint %I',r.tbl,r.conname); end loop;
end $$;

drop index if exists public.publication_jobs_owner_id_idempotency_key_idx;
drop index if exists public.automation_jobs_owner_id_idempotency_key_idx;
drop index if exists public.growth_plan_one_active_track_idx;

create unique index if not exists publication_jobs_artist_idempotency_idx on public.publication_jobs(artist_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists automation_jobs_artist_idempotency_idx on public.automation_jobs(artist_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists growth_opportunities_artist_dedupe_idx on public.growth_opportunities(artist_id,dedupe_key);
create unique index if not exists growth_plan_one_active_track_artist_idx on public.growth_plan_items(artist_id,track_vault_id) where track_vault_id is not null and status in ('proposed','accepted','scheduled');
create unique index if not exists audience_interactions_artist_external_idx on public.audience_interactions(artist_id,platform,external_interaction_id);
create unique index if not exists marketing_opportunities_artist_external_idx on public.marketing_opportunities(artist_id,source,external_key);
create unique index if not exists next_best_actions_artist_idempotency_idx on public.next_best_actions(artist_id,idempotency_key);
create unique index if not exists creative_derivatives_artist_package_idx on public.creative_derivatives(artist_id,master_content_item_id,target_package_id);
create unique index if not exists marketing_media_jobs_artist_idempotency_idx on public.marketing_media_jobs(artist_id,idempotency_key);

create index if not exists campaigns_artist_status_idx on public.campaigns(artist_id,status,updated_at desc);
create index if not exists content_items_artist_schedule_idx on public.content_items(artist_id,status,scheduled_at);
create index if not exists publication_jobs_artist_due_idx on public.publication_jobs(artist_id,status,scheduled_at);
create index if not exists automation_jobs_artist_due_idx on public.automation_jobs(artist_id,status,run_after);
create index if not exists marketing_learnings_artist_idx on public.marketing_learnings(artist_id,status,created_at desc);
create index if not exists metric_snapshots_artist_idx on public.metric_snapshots(artist_id,captured_at desc);
create index if not exists track_vault_artist_status_idx on public.track_vault(artist_id,status,updated_at desc);
create index if not exists growth_plan_artist_date_idx on public.growth_plan_items(artist_id,target_date,sort_order);
create index if not exists growth_opportunities_artist_status_idx on public.growth_opportunities(artist_id,status,priority desc);
create index if not exists next_best_actions_artist_status_idx on public.next_best_actions(artist_id,status,score desc);

-- ---------------------------------------------------------------------------
-- 5. Artist-aware Social OAuth token access. Legacy RPCs remain deterministic for Atlas only.
-- ---------------------------------------------------------------------------

create or replace function public.get_social_channel_token_for_artist(p_owner_id uuid,p_artist_id uuid,p_platform text)
returns table(access_token text,refresh_token text,scope text,expires_at timestamptz,refresh_expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_operational_artist_owner(p_owner_id,p_artist_id);
  return query select t.access_token,t.refresh_token,t.scope,t.expires_at,t.refresh_expires_at
  from private.social_channel_tokens t where t.owner_id=p_owner_id and t.artist_id=p_artist_id and t.platform=p_platform;
end $$;

create or replace function public.upsert_social_channel_token_for_artist(
  p_owner_id uuid,p_artist_id uuid,p_platform text,p_access_token text,p_refresh_token text,p_scope text,p_expires_at timestamptz,p_refresh_expires_at timestamptz
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_operational_artist_owner(p_owner_id,p_artist_id);
  insert into private.social_channel_tokens(owner_id,artist_id,platform,access_token,refresh_token,scope,expires_at,refresh_expires_at)
  values(p_owner_id,p_artist_id,p_platform,p_access_token,p_refresh_token,p_scope,p_expires_at,p_refresh_expires_at)
  on conflict(artist_id,platform) do update set owner_id=excluded.owner_id,access_token=excluded.access_token,refresh_token=excluded.refresh_token,scope=excluded.scope,expires_at=excluded.expires_at,refresh_expires_at=excluded.refresh_expires_at,updated_at=now();
end $$;

create or replace function public.delete_social_channel_token_for_artist(p_owner_id uuid,p_artist_id uuid,p_platform text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_operational_artist_owner(p_owner_id,p_artist_id);
  delete from private.social_channel_tokens where owner_id=p_owner_id and artist_id=p_artist_id and platform=p_platform;
end $$;

revoke all on function public.get_social_channel_token_for_artist(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.upsert_social_channel_token_for_artist(uuid,uuid,text,text,text,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.delete_social_channel_token_for_artist(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.get_social_channel_token_for_artist(uuid,uuid,text) to service_role;
grant execute on function public.upsert_social_channel_token_for_artist(uuid,uuid,text,text,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.delete_social_channel_token_for_artist(uuid,uuid,text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Growth engine: all automatic aggregation and dedupe happens inside one artist.
-- ---------------------------------------------------------------------------

create or replace function private.rebuild_growth_plan(p_owner_id uuid,p_artist_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare cfg record; candidate record; cursor_date date; horizon_date date; spacing_days integer; candidate_score numeric(5,2);
begin
  perform private.assert_operational_artist_owner(p_owner_id,p_artist_id);
  select coalesce(s.planning_horizon_days,90) planning_horizon_days,coalesce(s.release_cadence_days,28) release_cadence_days,coalesce(s.minimum_candidate_score,55) minimum_candidate_score,coalesce(s.autoplan_enabled,true) autoplan_enabled into cfg
  from (select p_artist_id artist_id) seed left join public.artist_growth_settings s on s.artist_id=seed.artist_id;
  if not coalesce(cfg.autoplan_enabled,true) then return; end if;
  delete from public.growth_plan_items where artist_id=p_artist_id and status='proposed' and source='decision_engine';
  horizon_date:=current_date+cfg.planning_horizon_days; spacing_days:=greatest(7,round(cfg.release_cadence_days*0.72)::integer); cursor_date:=current_date+21; cursor_date:=cursor_date+((5-extract(dow from cursor_date)::integer+7)%7);
  for candidate in select v.*,least(100,greatest(0,coalesce(v.artist_rating,3)*20*0.20+v.hook_strength*0.25+v.short_form_potential*0.20+v.uniqueness_score*0.15+v.release_readiness*0.15+v.visual_potential*0.05+case v.status when 'idea' then -18 when 'demo' then -12 when 'mix' then -6 when 'release_candidate' then 4 when 'hold' then -4 else 0 end))::numeric(5,2) portfolio_score from public.track_vault v where v.artist_id=p_artist_id and v.linked_release_id is null and v.status not in('released','archived','scheduled') and not(v.status='hold' and (v.hold_until is null or v.hold_until>current_date)) order by portfolio_score desc,v.updated_at desc
  loop
    candidate_score:=candidate.portfolio_score; if candidate_score<cfg.minimum_candidate_score then continue; end if;
    while cursor_date<=horizon_date and (exists(select 1 from public.releases r where r.artist_id=p_artist_id and r.release_date is not null and r.status in('Idea','In Progress','Scheduled') and abs(r.release_date-cursor_date)<spacing_days) or exists(select 1 from public.growth_plan_items gp where gp.artist_id=p_artist_id and gp.status in('proposed','accepted','scheduled') and abs(gp.target_date-cursor_date)<spacing_days)) loop cursor_date:=cursor_date+7; cursor_date:=cursor_date+((5-extract(dow from cursor_date)::integer+7)%7); end loop;
    exit when cursor_date>horizon_date;
    insert into public.growth_plan_items(owner_id,artist_id,track_vault_id,target_date,sort_order,candidate_score,rationale,status,source)
    values(p_owner_id,p_artist_id,candidate.id,cursor_date,(select count(*) from public.growth_plan_items where artist_id=p_artist_id and status='proposed' and source='decision_engine'),candidate_score,format('Automatic portfolio slot. Hook %s/100, short-form %s/100, uniqueness %s/100, readiness %s/100.',candidate.hook_strength,candidate.short_form_potential,candidate.uniqueness_score,candidate.release_readiness),'proposed','decision_engine') on conflict do nothing;
    cursor_date:=cursor_date+cfg.release_cadence_days; cursor_date:=cursor_date+((5-extract(dow from cursor_date)::integer+7)%7);
  end loop;
end $$;
revoke all on function private.rebuild_growth_plan(uuid,uuid) from public,anon,authenticated;

-- Legacy signature is a deterministic compatibility shim, never a multi-artist owner aggregate.
create or replace function private.rebuild_growth_plan(p_owner_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare a uuid; begin a:=private.legacy_artist_for_owner(p_owner_id); if a is null then raise exception 'Explicit artist_id is required to rebuild growth plan'; end if; perform private.rebuild_growth_plan(p_owner_id,a); end $$;
revoke all on function private.rebuild_growth_plan(uuid) from public,anon,authenticated;

create or replace function private.refresh_growth_plan_from_vault()
returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.rebuild_growth_plan(coalesce(new.owner_id,old.owner_id),coalesce(new.artist_id,old.artist_id)); return coalesce(new,old); end $$;
create or replace function private.refresh_growth_plan_from_release()
returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.rebuild_growth_plan(coalesce(new.owner_id,old.owner_id),coalesce(new.artist_id,old.artist_id)); return coalesce(new,old); end $$;
revoke all on function private.refresh_growth_plan_from_vault() from public,anon,authenticated;
revoke all on function private.refresh_growth_plan_from_release() from public,anon,authenticated;

create or replace function private.detect_growth_from_metric()
returns trigger language plpgsql security definer set search_path='' as $$
declare denominator numeric; quality_rate numeric; save_rate numeric; follow_rate numeric; release_title text; release_status text;
begin
  if new.content_item_id is not null then
    denominator:=greatest(coalesce(new.views,0),coalesce(new.reach,0));
    if denominator>=300 then quality_rate:=(coalesce(new.saves,0)+coalesce(new.playlist_adds,0)+coalesce(new.follows,0)*2.0)/denominator;
      if quality_rate>=0.015 then
        insert into public.growth_opportunities(owner_id,artist_id,kind,release_id,content_item_id,title,rationale,priority,confidence,evidence,recommended_action,dedupe_key,status,detected_at)
        select new.owner_id,new.artist_id,'content_breakout',ci.release_id,ci.id,ci.title||' is producing unusually strong fan intent','This content crossed the event-driven quality threshold. Create derivatives from the winning premise instead of starting over.',least(96,greatest(70,round(70+quality_rate*500)::integer)),case when denominator>=1500 then 0.90 else 0.75 end,jsonb_build_object('qualityRate',quality_rate,'views',new.views,'reach',new.reach,'saves',new.saves,'follows',new.follows),jsonb_build_object('type','create_derivatives','count',3),'content:'||ci.id,'new',now() from public.content_items ci where ci.id=new.content_item_id and ci.artist_id=new.artist_id
        on conflict(artist_id,dedupe_key) do update set title=excluded.title,rationale=excluded.rationale,priority=excluded.priority,confidence=excluded.confidence,evidence=excluded.evidence,recommended_action=excluded.recommended_action,detected_at=excluded.detected_at,status=case when public.growth_opportunities.status in('dismissed','completed') then public.growth_opportunities.status else 'new' end,updated_at=now();
      end if;
    end if;
  end if;
  if new.release_id is not null then
    select r.title,r.status::text into release_title,release_status from public.releases r where r.id=new.release_id and r.artist_id=new.artist_id;
    denominator:=greatest(coalesce(new.listeners,0),coalesce(new.streams,0));
    if release_status='Live' and denominator>=20 then save_rate:=coalesce(new.saves,0)/denominator; follow_rate:=coalesce(new.follows,0)/denominator;
      if save_rate>=0.06 or follow_rate>=0.045 then
        insert into public.growth_opportunities(owner_id,artist_id,kind,release_id,title,rationale,priority,confidence,evidence,recommended_action,dedupe_key,status,detected_at)
        values(new.owner_id,new.artist_id,'catalog_revival',new.release_id,release_title||' is showing catalog revival potential','A fresh metric snapshot shows durable listener intent above the catalog opportunity threshold.',least(94,greatest(62,round(62+save_rate*220+follow_rate*160)::integer)),case when denominator>=100 then 0.88 else 0.70 end,jsonb_build_object('saveRate',save_rate,'followRate',follow_rate,'listeners',new.listeners,'streams',new.streams),jsonb_build_object('type','catalog_revival','durationDays',7,'objective','Streams'),'catalog:'||new.release_id,'new',now())
        on conflict(artist_id,dedupe_key) do update set title=excluded.title,rationale=excluded.rationale,priority=excluded.priority,confidence=excluded.confidence,evidence=excluded.evidence,recommended_action=excluded.recommended_action,detected_at=excluded.detected_at,status=case when public.growth_opportunities.status in('dismissed','completed') then public.growth_opportunities.status else 'new' end,updated_at=now();
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.detect_growth_from_metric() from public,anon,authenticated;

create or replace function private.refresh_release_growth_risk(p_release_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r record; content_count integer; ready_count integer; days_remaining integer;
begin
  if p_release_id is null then return; end if;
  select id,owner_id,artist_id,title,status::text status,release_date into r from public.releases where id=p_release_id; if not found then return; end if;
  if r.status<>'Scheduled' or r.release_date is null or r.release_date<current_date or r.release_date>current_date+21 then update public.growth_opportunities set status='expired',updated_at=now() where artist_id=r.artist_id and dedupe_key='risk:'||r.id and status='new'; return; end if;
  select count(*),count(*) filter(where asset_url is not null or status::text in('Ready','Scheduled','Published')) into content_count,ready_count from public.content_items where artist_id=r.artist_id and release_id=r.id and status::text<>'Archived';
  days_remaining:=r.release_date-current_date;
  if content_count<4 or ready_count<2 then
    insert into public.growth_opportunities(owner_id,artist_id,kind,release_id,title,rationale,priority,confidence,evidence,recommended_action,dedupe_key,status,detected_at)
    values(r.owner_id,r.artist_id,'release_risk',r.id,r.title||' has a launch-readiness risk',format('%s days remain, but only %s content moments exist and %s have a usable asset/readiness signal.',days_remaining,content_count,ready_count),least(96,greatest(70,92-days_remaining)),0.94,jsonb_build_object('daysUntilRelease',days_remaining,'contentMoments',content_count,'readyMoments',ready_count),jsonb_build_object('type','finish_release_plan','minimumContentMoments',4),'risk:'||r.id,'new',now())
    on conflict(artist_id,dedupe_key) do update set title=excluded.title,rationale=excluded.rationale,priority=excluded.priority,confidence=excluded.confidence,evidence=excluded.evidence,recommended_action=excluded.recommended_action,detected_at=excluded.detected_at,status=case when public.growth_opportunities.status in('dismissed','completed') then public.growth_opportunities.status else 'new' end,updated_at=now();
  else update public.growth_opportunities set status='expired',updated_at=now() where artist_id=r.artist_id and dedupe_key='risk:'||r.id and status='new'; end if;
end $$;
revoke all on function private.refresh_release_growth_risk(uuid) from public,anon,authenticated;

-- Rebuild current artist-local state after the cutover.
do $$ declare x record; begin
  for x in select distinct owner_id,artist_id from public.track_vault loop perform private.rebuild_growth_plan(x.owner_id,x.artist_id); end loop;
  for x in select id from public.releases loop perform private.refresh_release_growth_risk(x.id); end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Artist membership RLS is additive. Active-artist selection stays an application concern.
-- ---------------------------------------------------------------------------

do $$ declare t text; begin
  foreach t in array array[
    'tasks','brand_settings','release_learnings','campaigns','campaign_phases','campaign_experiments','campaign_moments','generation_runs','content_items','content_variants','publication_jobs','attribution_links','attribution_events','marketing_events','automation_jobs','marketing_learnings','metric_snapshots','outreach_contacts','outreach_sequences','outreach_sequence_steps','outreach_enrollments','outreach_messages','artist_growth_settings','track_vault','growth_plan_items','growth_opportunities','audience_interactions','marketing_opportunities','next_best_actions','social_channel_accounts','marketing_media_jobs','creative_derivatives','campaign_ai_spend_envelopes','campaign_ai_spend_reservations'
  ] loop
    execute format('drop policy if exists "studio admins artist select %1$s" on public.%1$I',t);
    execute format('create policy "studio admins artist select %1$s" on public.%1$I for select to authenticated using(private.is_studio_admin() and private.can_access_artist(artist_id))',t);
    execute format('drop policy if exists "studio admins artist insert %1$s" on public.%1$I',t);
    execute format('create policy "studio admins artist insert %1$s" on public.%1$I for insert to authenticated with check(private.is_studio_admin() and private.can_access_artist(artist_id))',t);
    execute format('drop policy if exists "studio admins artist update %1$s" on public.%1$I',t);
    execute format('create policy "studio admins artist update %1$s" on public.%1$I for update to authenticated using(private.is_studio_admin() and private.can_access_artist(artist_id)) with check(private.is_studio_admin() and private.can_access_artist(artist_id))',t);
    execute format('drop policy if exists "studio admins artist delete %1$s" on public.%1$I',t);
    execute format('create policy "studio admins artist delete %1$s" on public.%1$I for delete to authenticated using(private.is_studio_admin() and private.can_access_artist(artist_id))',t);
  end loop;
end $$;
