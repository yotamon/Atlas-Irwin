-- Ensemblis #71 follow-up hardening for exact legacy uniqueness names and paid/external workers.

-- Replace owner-local idempotency/active-slot indexes with the artist-local indexes created by
-- 20260903140000_operational_artist_scope.sql. These exact names come from the original migrations.
drop index if exists public.publication_jobs_idempotency_idx;
drop index if exists public.automation_jobs_idempotency_idx;
drop index if exists public.growth_plan_track_proposal_uidx;

-- marketing_media_jobs used a table UNIQUE constraint instead of a standalone index.
do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid='public.marketing_media_jobs'::regclass
      and contype='u'
      and pg_get_constraintdef(oid) ilike '%owner_id, idempotency_key%'
  loop
    execute format('alter table public.marketing_media_jobs drop constraint %I',r.conname);
  end loop;
end $$;

create unique index if not exists publication_jobs_artist_idempotency_idx
  on public.publication_jobs(artist_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists automation_jobs_artist_idempotency_idx
  on public.automation_jobs(artist_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists growth_plan_one_active_track_artist_idx
  on public.growth_plan_items(artist_id,track_vault_id)
  where track_vault_id is not null and status in ('proposed','accepted','scheduled');
create unique index if not exists marketing_media_jobs_artist_idempotency_idx
  on public.marketing_media_jobs(artist_id,idempotency_key);

-- Studio V2 predates artist scoping and used the retired owner-local publication idempotency key.
-- Re-declare the bridge after the artist migration so every approval job carries the Content
-- artist explicitly and sibling artists can safely produce identical deterministic keys.
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
  if new.artist_id is null then raise exception 'Studio V2 publication approval requires explicit artist scope'; end if;
  if tg_op = 'UPDATE'
     and old.platform is not distinct from new.platform
     and old.scheduled_at is not distinct from new.scheduled_at
     and old.asset_url is not distinct from new.asset_url
     and old.caption is not distinct from new.caption
     and old.hook_text is not distinct from new.hook_text
     and old.cta is not distinct from new.cta then return new; end if;

  update public.publication_jobs
  set status = 'cancelled', last_error = 'Superseded by a newer Studio V2 content payload.'
  where artist_id = new.artist_id
    and content_item_id = new.id
    and status in ('draft','awaiting_approval','approved','scheduled','manual_ready');

  v_key := 'studio-v2:' || new.id::text || ':' || md5(coalesce(new.platform::text, '') || '|' || coalesce(new.scheduled_at::text, '') || '|' || coalesce(new.asset_url, '') || '|' || coalesce(new.caption, '') || '|' || coalesce(new.hook_text, '') || '|' || coalesce(new.cta, ''));

  insert into public.publication_jobs (
    owner_id,artist_id,campaign_id,content_item_id,platform,adapter,status,
    requires_approval,approval_status,scheduled_at,request_payload,idempotency_key
  ) values (
    new.owner_id,new.artist_id,new.campaign_id,new.id,new.platform::text,'studio-v2','awaiting_approval',
    true,'pending',new.scheduled_at,
    jsonb_build_object('artistId',new.artist_id,'hookText',new.hook_text,'caption',new.caption,'cta',new.cta,'assetUrl',new.asset_url),
    v_key
  )
  on conflict (artist_id, idempotency_key) where idempotency_key is not null
  do update set campaign_id=excluded.campaign_id,
                content_item_id=excluded.content_item_id,
                platform=excluded.platform,
                status='awaiting_approval',
                approval_status='pending',
                scheduled_at=excluded.scheduled_at,
                request_payload=excluded.request_payload,
                last_error=null,
                updated_at=now();

  return new;
end;
$$;
revoke all on function private.sync_studio_v2_publication_approval() from public,anon,authenticated;

-- External-effect and paid-worker rows must agree with every durable linked entity, not merely the
-- nearest parent. These checks execute for service_role too because RLS is not a worker boundary.
create or replace function private.validate_marketing_media_job_artist_lineage()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare linked uuid;
begin
  select artist_id into linked from public.content_items where id=new.content_item_id;
  if linked is null or linked<>new.artist_id then raise exception 'Media job content must belong to job artist'; end if;
  if new.campaign_id is not null then
    select artist_id into linked from public.campaigns where id=new.campaign_id;
    if linked is null or linked<>new.artist_id then raise exception 'Media job campaign must belong to job artist'; end if;
  end if;
  if new.release_id is not null then
    select artist_id into linked from public.releases where id=new.release_id;
    if linked is null or linked<>new.artist_id then raise exception 'Media job release must belong to job artist'; end if;
  end if;
  if new.generation_run_id is not null then
    select artist_id into linked from public.generation_runs where id=new.generation_run_id;
    if linked is null or linked<>new.artist_id then raise exception 'Media job generation run must belong to job artist'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_marketing_media_job_artist_lineage() from public,anon,authenticated;
drop trigger if exists marketing_media_jobs_validate_full_artist_lineage on public.marketing_media_jobs;
create trigger marketing_media_jobs_validate_full_artist_lineage
  before insert or update on public.marketing_media_jobs
  for each row execute function private.validate_marketing_media_job_artist_lineage();

create or replace function private.validate_creative_derivative_artist_lineage()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare linked uuid;
begin
  select artist_id into linked from public.content_items where id=new.master_content_item_id;
  if linked is null or linked<>new.artist_id then raise exception 'Creative derivative master content must belong to derivative artist'; end if;
  if new.derivative_content_item_id is not null then
    select artist_id into linked from public.content_items where id=new.derivative_content_item_id;
    if linked is null or linked<>new.artist_id then raise exception 'Creative derivative output must belong to derivative artist'; end if;
  end if;
  if new.campaign_id is not null then
    select artist_id into linked from public.campaigns where id=new.campaign_id;
    if linked is null or linked<>new.artist_id then raise exception 'Creative derivative campaign must belong to derivative artist'; end if;
  end if;
  select artist_id into linked from public.generation_runs where id=new.master_generation_run_id;
  if linked is null or linked<>new.artist_id then raise exception 'Creative derivative master generation must belong to derivative artist'; end if;
  if new.derivative_generation_run_id is not null then
    select artist_id into linked from public.generation_runs where id=new.derivative_generation_run_id;
    if linked is null or linked<>new.artist_id then raise exception 'Creative derivative generation output must belong to derivative artist'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_creative_derivative_artist_lineage() from public,anon,authenticated;
drop trigger if exists creative_derivatives_validate_full_artist_lineage on public.creative_derivatives;
create trigger creative_derivatives_validate_full_artist_lineage
  before insert or update on public.creative_derivatives
  for each row execute function private.validate_creative_derivative_artist_lineage();

create or replace function private.validate_campaign_spend_reservation_artist_lineage()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare linked uuid;
begin
  select artist_id into linked from public.campaigns where id=new.campaign_id;
  if linked is null or linked<>new.artist_id then raise exception 'Campaign spend reservation campaign must belong to reservation artist'; end if;
  select artist_id into linked from public.campaign_ai_spend_envelopes where id=new.envelope_id;
  if linked is null or linked<>new.artist_id then raise exception 'Campaign spend reservation envelope must belong to reservation artist'; end if;
  select artist_id into linked from public.generation_runs where id=new.generation_run_id;
  if linked is null or linked<>new.artist_id then raise exception 'Campaign spend reservation generation run must belong to reservation artist'; end if;
  return new;
end;
$$;
revoke all on function private.validate_campaign_spend_reservation_artist_lineage() from public,anon,authenticated;
drop trigger if exists campaign_ai_spend_reservations_validate_full_artist_lineage on public.campaign_ai_spend_reservations;
create trigger campaign_ai_spend_reservations_validate_full_artist_lineage
  before insert or update on public.campaign_ai_spend_reservations
  for each row execute function private.validate_campaign_spend_reservation_artist_lineage();
