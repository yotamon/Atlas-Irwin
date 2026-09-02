-- Product lifecycle hardening for Atlas Studio.
-- The database must never recreate impossible pre-release work for an already-live release.
-- This migration is intentionally deterministic and contains no external calls or paid work.

create or replace function private.ensure_release_growth_playbook(p_release_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.releases%rowtype;
  today_berlin date := (now() at time zone 'Europe/Berlin')::date;
  catalog_due timestamptz;
begin
  select * into r from public.releases where id = p_release_id;
  if not found then return; end if;

  -- Upcoming/undated releases use the complete release-relative preparation playbook.
  if r.release_date is null or r.release_date >= today_berlin then
    insert into public.tasks(owner_id, release_id, title, status, priority, due_at, category, external_key, metadata)
    values
      (r.owner_id, r.id, 'Choose the strongest short-form hook', 'Open', 'High', case when r.release_date is null then null else ((r.release_date - 21)::timestamp + time '10:00') at time zone 'Europe/Berlin' end, 'growth', 'growth.hook-test', '{"phase":"prepare","description":"Test the musical moment before spending on finished creative.","evidence_kind":"derived"}'::jsonb),
      (r.owner_id, r.id, 'Pitch the release in Spotify for Artists', 'Open', 'High', case when r.release_date is null then null else ((r.release_date - 14)::timestamp + time '10:00') at time zone 'Europe/Berlin' end, 'spotify', 'spotify.pitch', '{"phase":"prepare","description":"Prepare the editorial pitch with enough lead time.","evidence_kind":"platform_workflow"}'::jsonb),
      (r.owner_id, r.id, 'Prepare pre-save / smart link', 'Open', 'High', case when r.release_date is null then null else ((r.release_date - 14)::timestamp + time '11:00') at time zone 'Europe/Berlin' end, 'spotify', 'spotify.presave', '{"phase":"build_hype","description":"One measurable destination for campaign traffic.","evidence_kind":"workflow"}'::jsonb),
      (r.owner_id, r.id, 'Create Spotify Canvas', 'Open', 'Medium', case when r.release_date is null then null else ((r.release_date - 7)::timestamp + time '10:00') at time zone 'Europe/Berlin' end, 'spotify', 'spotify.canvas', '{"phase":"build_hype","description":"Keep the visual world consistent with the winning campaign concept.","evidence_kind":"workflow"}'::jsonb),
      (r.owner_id, r.id, 'Set up Countdown Page if the release is eligible', 'Open', 'Medium', case when r.release_date is null then null else ((r.release_date - 14)::timestamp + time '12:00') at time zone 'Europe/Berlin' end, 'spotify', 'spotify.countdown', '{"phase":"build_hype","conditional":true,"description":"Use only when Spotify makes the release eligible.","evidence_kind":"platform_workflow"}'::jsonb),
      (r.owner_id, r.id, 'Turn the winning hook into three native derivatives', 'Open', 'High', case when r.release_date is null then null else ((r.release_date - 7)::timestamp + time '11:00') at time zone 'Europe/Berlin' end, 'creative', 'growth.derivatives', '{"phase":"build_hype","description":"Scale the winner instead of producing unrelated filler.","evidence_kind":"experiment"}'::jsonb),
      (r.owner_id, r.id, 'Refresh Artist Pick and release-facing profile surfaces', 'Open', 'High', case when r.release_date is null then null else (r.release_date::timestamp + time '09:00') at time zone 'Europe/Berlin' end, 'spotify', 'spotify.artist-pick', '{"phase":"release","description":"Make the release the obvious next action for profile visitors.","evidence_kind":"workflow"}'::jsonb),
      (r.owner_id, r.id, 'Review the first seven days and decide what to scale', 'Open', 'High', case when r.release_date is null then null else ((r.release_date + 7)::timestamp + time '10:00') at time zone 'Europe/Berlin' end, 'growth', 'growth.week-one-review', '{"phase":"sustain","description":"Scale winning creative and capture evidence-backed learnings.","evidence_kind":"measured"}'::jsonb),
      (r.owner_id, r.id, 'Check whether this track deserves a catalog revival', 'Open', 'Medium', case when r.release_date is null then null else ((r.release_date + 28)::timestamp + time '10:00') at time zone 'Europe/Berlin' end, 'growth', 'growth.catalog-review', '{"phase":"sustain","description":"Do not let a release disappear just because launch week ended.","evidence_kind":"measured"}'::jsonb)
    on conflict (owner_id, release_id, external_key) where release_id is not null and external_key is not null
    do update set
      due_at = excluded.due_at,
      category = excluded.category,
      metadata = excluded.metadata,
      updated_at = now();
    return;
  end if;

  -- Already-live releases are not allowed to manufacture guilt debt. Any unfinished task whose
  -- opportunity window is already behind us becomes explicitly Skipped rather than appearing overdue.
  update public.tasks
  set
    status = 'Skipped',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'lifecycle_resolution', 'auto_skipped',
      'lifecycle_reason', 'Release was already live when this task became actionable.',
      'resolved_at', now()
    ),
    updated_at = now()
  where owner_id = r.owner_id
    and release_id = r.id
    and external_key in (
      'growth.hook-test','spotify.pitch','spotify.presave','spotify.canvas','spotify.countdown',
      'growth.derivatives','spotify.artist-pick','growth.week-one-review','growth.catalog-review'
    )
    and status not in ('Done','Skipped')
    and due_at is not null
    and due_at < now();

  -- If a legitimate post-release checkpoint is still ahead, keep its original date.
  if r.release_date + 7 >= today_berlin then
    insert into public.tasks(owner_id, release_id, title, status, priority, due_at, category, external_key, metadata)
    values (
      r.owner_id, r.id, 'Review the first seven days and decide what to scale', 'Open', 'High',
      ((r.release_date + 7)::timestamp + time '10:00') at time zone 'Europe/Berlin',
      'growth', 'growth.week-one-review',
      '{"phase":"sustain","description":"Scale winning creative and capture evidence-backed learnings.","evidence_kind":"measured"}'::jsonb
    )
    on conflict (owner_id, release_id, external_key) where release_id is not null and external_key is not null
    do update set due_at = excluded.due_at, category = excluded.category, metadata = excluded.metadata, updated_at = now();
  end if;

  if r.release_date + 28 >= today_berlin then
    insert into public.tasks(owner_id, release_id, title, status, priority, due_at, category, external_key, metadata)
    values (
      r.owner_id, r.id, 'Check whether this track deserves a catalog revival', 'Open', 'Medium',
      ((r.release_date + 28)::timestamp + time '10:00') at time zone 'Europe/Berlin',
      'growth', 'growth.catalog-review',
      '{"phase":"sustain","description":"Use current evidence to decide whether the catalog deserves another push.","evidence_kind":"measured"}'::jsonb
    )
    on conflict (owner_id, release_id, external_key) where release_id is not null and external_key is not null
    do update set due_at = excluded.due_at, category = excluded.category, metadata = excluded.metadata, updated_at = now();
  else
    -- Old catalog gets one current-day decision, not a pile of historical launch tasks.
    catalog_due := ((today_berlin + 1)::timestamp + time '10:00') at time zone 'Europe/Berlin';
    insert into public.tasks(owner_id, release_id, title, status, priority, due_at, category, external_key, metadata)
    values (
      r.owner_id, r.id, 'Review the current catalog growth opportunity', 'Open', 'Medium', catalog_due,
      'growth', 'growth.catalog-now',
      jsonb_build_object(
        'phase','sustain',
        'description','Treat this as live catalog. Review current signal and decide whether Atlas should create a fresh rediscovery cycle.',
        'evidence_kind','measured',
        'lifecycle','catalog'
      )
    )
    on conflict (owner_id, release_id, external_key) where release_id is not null and external_key is not null
    do update set
      title = excluded.title,
      due_at = case when public.tasks.status in ('Done','Skipped') then public.tasks.due_at else excluded.due_at end,
      category = excluded.category,
      metadata = excluded.metadata,
      updated_at = now();
  end if;
end;
$$;

revoke all on function private.ensure_release_growth_playbook(uuid) from public, anon, authenticated;

-- Repair current task debt immediately, then regenerate only lifecycle-valid tasks.
update public.tasks t
set
  status = 'Skipped',
  metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'lifecycle_resolution', 'migration_auto_skipped',
    'lifecycle_reason', 'Historical release task was already impossible when Atlas created or migrated the workflow.',
    'resolved_at', now()
  ),
  updated_at = now()
from public.releases r
where r.id = t.release_id
  and r.release_date < (now() at time zone 'Europe/Berlin')::date
  and t.external_key in (
    'growth.hook-test','spotify.pitch','spotify.presave','spotify.canvas','spotify.countdown',
    'growth.derivatives','spotify.artist-pick','growth.week-one-review','growth.catalog-review'
  )
  and t.status not in ('Done','Skipped')
  and t.due_at is not null
  and t.due_at < now();

do $$
declare rid uuid;
begin
  for rid in select id from public.releases loop
    perform private.ensure_release_growth_playbook(rid);
  end loop;
end $$;

-- Campaign phases describe time windows, not promises that work happened. An elapsed phase with
-- no published content is Skipped; one with actual published output is Completed.
update public.campaign_phases p
set
  status = case
    when p.starts_at is not null and p.ends_at is not null and now() >= p.starts_at and now() < p.ends_at then 'active'
    when p.ends_at is not null and now() >= p.ends_at then
      case when exists (
        select 1 from public.content_items ci
        where ci.phase_id = p.id and ci.status = 'Published'
      ) then 'completed' else 'skipped' end
    else 'planned'
  end,
  updated_at = now()
where p.status in ('planned','active');

-- Unambiguous orphan content generations cannot remain queued forever. If Atlas never received a
-- provider request id, failing the local run is safe and explicitly prevents an accidental paid retry.
update public.generation_runs gr
set
  status = 'failed',
  completed_at = now(),
  error = 'Lifecycle reconciliation stopped this run because its source content item no longer exists. No retry was submitted.',
  metadata = coalesce(gr.metadata, '{}'::jsonb) || jsonb_build_object(
    'reconciledOrphan', true,
    'reconciliationPolicy', 'no_provider_request_safe_fail'
  ),
  updated_at = now()
where gr.status in ('queued','running')
  and gr.provider_request_id is null
  and gr.purpose ~* '^content_asset:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and not exists (
    select 1 from public.content_items ci
    where ci.id = substring(gr.purpose from '^content_asset:([0-9a-fA-F-]{36})$')::uuid
  );
