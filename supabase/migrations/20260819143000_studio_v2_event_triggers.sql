-- Studio V2 durable workflow bridge.
-- Existing marketing migrations already provide release-date cascade and
-- metric/content-published event triggers. This migration adds evidence-derived
-- content state, approval generation, provider scheduling state, and the free starter plan.

alter table public.publication_jobs
  drop constraint if exists publication_jobs_status_check;

alter table public.publication_jobs
  add constraint publication_jobs_status_check
  check (status in ('draft','awaiting_approval','approved','scheduled','publishing','manual_ready','provider_scheduled','published','failed','cancelled'));

create or replace function private.derive_studio_v2_content_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and exists (
       select 1
       from public.publication_jobs pj
       where pj.content_item_id = new.id
         and pj.status = 'provider_scheduled'
     )
     and (
       old.platform is distinct from new.platform
       or old.scheduled_at is distinct from new.scheduled_at
       or old.asset_url is distinct from new.asset_url
       or old.caption is distinct from new.caption
       or old.hook_text is distinct from new.hook_text
       or old.cta is distinct from new.cta
     ) then
    raise exception 'This content is already scheduled with an external provider. Change or cancel it at the provider before editing the external payload in Atlas.';
  end if;

  if new.status = 'Archived' then return new; end if;
  if new.published_at is not null or new.status = 'Published' then
    new.status := 'Published';
  elsif new.scheduled_at is not null and new.asset_url is not null then
    new.status := 'Scheduled';
  elsif new.asset_url is not null and (new.caption is not null or new.hook_text is not null) then
    new.status := 'Ready';
  elsif new.asset_url is not null or new.caption is not null or new.hook_text is not null then
    new.status := 'In Production';
  else
    new.status := 'Draft';
  end if;
  return new;
end;
$$;

revoke all on function private.derive_studio_v2_content_state() from public, anon, authenticated;

drop trigger if exists studio_v2_content_state_insert on public.content_items;
create trigger studio_v2_content_state_insert before insert on public.content_items for each row execute function private.derive_studio_v2_content_state();

drop trigger if exists studio_v2_content_state_update on public.content_items;
create trigger studio_v2_content_state_update before update of platform, asset_url, caption, hook_text, cta, scheduled_at, published_at on public.content_items for each row execute function private.derive_studio_v2_content_state();

create or replace function private.sync_studio_v2_publication_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if new.status <> 'Scheduled' or new.scheduled_at is null or new.asset_url is null then return new; end if;
  if tg_op = 'UPDATE'
     and old.platform is not distinct from new.platform
     and old.scheduled_at is not distinct from new.scheduled_at
     and old.asset_url is not distinct from new.asset_url
     and old.caption is not distinct from new.caption
     and old.hook_text is not distinct from new.hook_text
     and old.cta is not distinct from new.cta then return new; end if;

  update public.publication_jobs
  set status = 'cancelled', last_error = 'Superseded by a newer Studio V2 content payload.'
  where owner_id = new.owner_id and content_item_id = new.id and status in ('draft','awaiting_approval','approved','scheduled','manual_ready');

  v_key := 'studio-v2:' || new.id::text || ':' || md5(coalesce(new.platform::text, '') || '|' || coalesce(new.scheduled_at::text, '') || '|' || coalesce(new.asset_url, '') || '|' || coalesce(new.caption, '') || '|' || coalesce(new.hook_text, '') || '|' || coalesce(new.cta, ''));

  insert into public.publication_jobs (owner_id,campaign_id,content_item_id,platform,adapter,status,requires_approval,approval_status,scheduled_at,request_payload,idempotency_key)
  values (new.owner_id,new.campaign_id,new.id,new.platform::text,'studio-v2','awaiting_approval',true,'pending',new.scheduled_at,jsonb_build_object('hookText',new.hook_text,'caption',new.caption,'cta',new.cta,'assetUrl',new.asset_url),v_key)
  on conflict (owner_id, idempotency_key) where idempotency_key is not null
  do update set campaign_id=excluded.campaign_id, platform=excluded.platform, status='awaiting_approval', approval_status='pending', scheduled_at=excluded.scheduled_at, request_payload=excluded.request_payload, last_error=null, updated_at=now();

  return new;
end;
$$;

revoke all on function private.sync_studio_v2_publication_approval() from public, anon, authenticated;

drop trigger if exists studio_v2_publication_approval_insert on public.content_items;
create trigger studio_v2_publication_approval_insert after insert on public.content_items for each row execute function private.sync_studio_v2_publication_approval();

drop trigger if exists studio_v2_publication_approval_update on public.content_items;
create trigger studio_v2_publication_approval_update after update of platform, asset_url, caption, hook_text, cta, scheduled_at on public.content_items for each row execute function private.sync_studio_v2_publication_approval();

create or replace function private.bootstrap_studio_v2_release_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release_id uuid;
  v_release_title text;
  v_anchor date;
begin
  if new.event_type <> 'release.workspace_created' or new.campaign_id is null then return new; end if;
  select c.release_id, c.release_anchor_date, r.title into v_release_id, v_anchor, v_release_title
  from public.campaigns c join public.releases r on r.id = c.release_id
  where c.id = new.campaign_id and c.owner_id = new.owner_id;
  if v_release_id is null then return new; end if;
  if exists (select 1 from public.content_items where campaign_id = new.campaign_id limit 1) then return new; end if;

  insert into public.content_items (owner_id,release_id,campaign_id,phase_id,title,platform,format,status,goal,scheduled_at,approval_status,source,content_angle,audience_segment,relative_day,schedule_locked,production_notes)
  select new.owner_id,v_release_id,new.campaign_id,phase.id,v_release_title || moment.title_suffix,moment.platform,moment.format,'Draft',moment.goal,
    case when v_anchor is null then null else ((v_anchor + moment.relative_day)::date + time '18:00') at time zone 'Europe/Berlin' end,
    'not_required','automation',moment.content_angle,moment.audience_segment,moment.relative_day,false,
    'Starter moment created automatically by Studio V2. Replace the generic angle with the release-specific creative when ready.'
  from (values
    (-14,' / first signal','Instagram','Reel','Reach','Introduce one distinctive sound or visual detail without announcing everything.','discovery','discovery'),
    (-7,' / hook test','TikTok','TikTok video','Saves','Test the strongest musical hook as one focused short-form idea.','new listeners','hook-test'),
    (-2,' / anticipation','Instagram','Reel','Profile Visits','Give emotional context and a reason to care before release day.','warm audience','anticipation'),
    (0,' / release day','Instagram','Reel','Streams','Make the release immediately understandable and easy to hear.','listeners','launch'),
    (7,' / second life','YouTube Shorts','Short','Follows','Reframe the track through process, performance or a different visual angle.','new listeners','momentum')
  ) as moment(relative_day,title_suffix,platform,format,goal,content_angle,audience_segment,phase_code)
  left join public.campaign_phases phase on phase.campaign_id = new.campaign_id and phase.code = moment.phase_code;
  return new;
end;
$$;

revoke all on function private.bootstrap_studio_v2_release_workspace() from public, anon, authenticated;

drop trigger if exists studio_v2_release_workspace_bootstrap on public.marketing_events;
create trigger studio_v2_release_workspace_bootstrap after insert on public.marketing_events for each row when (new.event_type = 'release.workspace_created') execute function private.bootstrap_studio_v2_release_workspace();
