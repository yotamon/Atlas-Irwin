-- Event-driven Growth OS. These functions use database work only: no model calls,
-- no external HTTP, no cron and no Vercel invocation.

create or replace function private.rebuild_growth_plan(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
  candidate record;
  cursor_date date;
  horizon_date date;
  spacing_days integer;
  candidate_score numeric(5,2);
begin
  select
    coalesce(s.planning_horizon_days, 90) as planning_horizon_days,
    coalesce(s.release_cadence_days, 28) as release_cadence_days,
    coalesce(s.minimum_candidate_score, 55) as minimum_candidate_score,
    coalesce(s.autoplan_enabled, true) as autoplan_enabled
  into cfg
  from (select p_owner_id as owner_id) seed
  left join public.artist_growth_settings s on s.owner_id = seed.owner_id;

  if not coalesce(cfg.autoplan_enabled, true) then
    return;
  end if;

  delete from public.growth_plan_items
  where owner_id = p_owner_id
    and status = 'proposed'
    and source = 'decision_engine';

  horizon_date := current_date + cfg.planning_horizon_days;
  spacing_days := greatest(7, round(cfg.release_cadence_days * 0.72)::integer);
  cursor_date := current_date + 21;
  cursor_date := cursor_date + ((5 - extract(dow from cursor_date)::integer + 7) % 7);

  for candidate in
    select
      v.*,
      least(100, greatest(0,
        coalesce(v.artist_rating, 3) * 20 * 0.20
        + v.hook_strength * 0.25
        + v.short_form_potential * 0.20
        + v.uniqueness_score * 0.15
        + v.release_readiness * 0.15
        + v.visual_potential * 0.05
        + case v.status
            when 'idea' then -18
            when 'demo' then -12
            when 'mix' then -6
            when 'release_candidate' then 4
            when 'hold' then -4
            else 0
          end
      ))::numeric(5,2) as portfolio_score
    from public.track_vault v
    where v.owner_id = p_owner_id
      and v.linked_release_id is null
      and v.status not in ('released','archived','scheduled')
      and not (v.status = 'hold' and (v.hold_until is null or v.hold_until > current_date))
    order by portfolio_score desc, v.updated_at desc
  loop
    candidate_score := candidate.portfolio_score;
    if candidate_score < cfg.minimum_candidate_score then
      continue;
    end if;

    while cursor_date <= horizon_date and (
      exists (
        select 1
        from public.releases r
        where r.owner_id = p_owner_id
          and r.release_date is not null
          and r.status in ('Idea','In Progress','Scheduled')
          and abs(r.release_date - cursor_date) < spacing_days
      )
      or exists (
        select 1
        from public.growth_plan_items gp
        where gp.owner_id = p_owner_id
          and gp.status in ('proposed','accepted','scheduled')
          and abs(gp.target_date - cursor_date) < spacing_days
      )
    ) loop
      cursor_date := cursor_date + 7;
      cursor_date := cursor_date + ((5 - extract(dow from cursor_date)::integer + 7) % 7);
    end loop;

    exit when cursor_date > horizon_date;

    insert into public.growth_plan_items (
      owner_id,
      track_vault_id,
      target_date,
      sort_order,
      candidate_score,
      rationale,
      status,
      source
    ) values (
      p_owner_id,
      candidate.id,
      cursor_date,
      (select count(*) from public.growth_plan_items where owner_id = p_owner_id and status = 'proposed' and source = 'decision_engine'),
      candidate_score,
      format(
        'Automatic portfolio slot. Hook %s/100, short-form %s/100, uniqueness %s/100, readiness %s/100.',
        candidate.hook_strength,
        candidate.short_form_potential,
        candidate.uniqueness_score,
        candidate.release_readiness
      ),
      'proposed',
      'decision_engine'
    )
    on conflict do nothing;

    cursor_date := cursor_date + cfg.release_cadence_days;
    cursor_date := cursor_date + ((5 - extract(dow from cursor_date)::integer + 7) % 7);
  end loop;
end;
$$;

revoke all on function private.rebuild_growth_plan(uuid) from public, anon, authenticated;

create or replace function private.refresh_growth_plan_from_vault()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_value uuid;
begin
  owner_value := coalesce(new.owner_id, old.owner_id);
  perform private.rebuild_growth_plan(owner_value);
  return coalesce(new, old);
end;
$$;

revoke all on function private.refresh_growth_plan_from_vault() from public, anon, authenticated;

drop trigger if exists refresh_growth_plan_from_vault on public.track_vault;
create trigger refresh_growth_plan_from_vault
after insert or update or delete on public.track_vault
for each row execute function private.refresh_growth_plan_from_vault();

create or replace function private.refresh_growth_plan_from_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_value uuid;
begin
  owner_value := coalesce(new.owner_id, old.owner_id);
  perform private.rebuild_growth_plan(owner_value);
  return coalesce(new, old);
end;
$$;

revoke all on function private.refresh_growth_plan_from_release() from public, anon, authenticated;

drop trigger if exists refresh_growth_plan_from_release on public.releases;
create trigger refresh_growth_plan_from_release
after insert or update of release_date, status or delete on public.releases
for each row execute function private.refresh_growth_plan_from_release();

create or replace function private.detect_growth_from_metric()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  denominator numeric;
  quality_rate numeric;
  save_rate numeric;
  follow_rate numeric;
  release_title text;
  release_status text;
begin
  if new.content_item_id is not null then
    denominator := greatest(coalesce(new.views, 0), coalesce(new.reach, 0));
    if denominator >= 300 then
      quality_rate := (coalesce(new.saves, 0) + coalesce(new.playlist_adds, 0) + coalesce(new.follows, 0) * 2.0) / denominator;
      if quality_rate >= 0.015 then
        insert into public.growth_opportunities (
          owner_id, kind, release_id, content_item_id, title, rationale,
          priority, confidence, evidence, recommended_action, dedupe_key, status, detected_at
        )
        select
          new.owner_id,
          'content_breakout',
          ci.release_id,
          ci.id,
          ci.title || ' is producing unusually strong fan intent',
          'This content crossed the event-driven quality threshold. Create derivatives from the winning premise instead of starting over.',
          least(96, greatest(70, round(70 + quality_rate * 500)::integer)),
          case when denominator >= 1500 then 0.90 else 0.75 end,
          jsonb_build_object('qualityRate', quality_rate, 'views', new.views, 'reach', new.reach, 'saves', new.saves, 'follows', new.follows),
          jsonb_build_object('type', 'create_derivatives', 'count', 3),
          'content:' || ci.id,
          'new',
          now()
        from public.content_items ci
        where ci.id = new.content_item_id
        on conflict (owner_id, dedupe_key) do update set
          title = excluded.title,
          rationale = excluded.rationale,
          priority = excluded.priority,
          confidence = excluded.confidence,
          evidence = excluded.evidence,
          recommended_action = excluded.recommended_action,
          detected_at = excluded.detected_at,
          status = case when public.growth_opportunities.status in ('dismissed','completed') then public.growth_opportunities.status else 'new' end,
          updated_at = now();
      end if;
    end if;
  end if;

  if new.release_id is not null then
    select r.title, r.status::text into release_title, release_status
    from public.releases r
    where r.id = new.release_id;

    denominator := greatest(coalesce(new.listeners, 0), coalesce(new.streams, 0));
    if release_status = 'Live' and denominator >= 20 then
      save_rate := coalesce(new.saves, 0) / denominator;
      follow_rate := coalesce(new.follows, 0) / denominator;
      if save_rate >= 0.06 or follow_rate >= 0.045 then
        insert into public.growth_opportunities (
          owner_id, kind, release_id, title, rationale, priority, confidence,
          evidence, recommended_action, dedupe_key, status, detected_at
        ) values (
          new.owner_id,
          'catalog_revival',
          new.release_id,
          release_title || ' is showing catalog revival potential',
          'A fresh metric snapshot shows durable listener intent above the catalog opportunity threshold.',
          least(94, greatest(62, round(62 + save_rate * 220 + follow_rate * 160)::integer)),
          case when denominator >= 100 then 0.88 else 0.70 end,
          jsonb_build_object('saveRate', save_rate, 'followRate', follow_rate, 'listeners', new.listeners, 'streams', new.streams),
          jsonb_build_object('type', 'catalog_revival', 'durationDays', 7, 'objective', 'Streams'),
          'catalog:' || new.release_id,
          'new',
          now()
        )
        on conflict (owner_id, dedupe_key) do update set
          title = excluded.title,
          rationale = excluded.rationale,
          priority = excluded.priority,
          confidence = excluded.confidence,
          evidence = excluded.evidence,
          recommended_action = excluded.recommended_action,
          detected_at = excluded.detected_at,
          status = case when public.growth_opportunities.status in ('dismissed','completed') then public.growth_opportunities.status else 'new' end,
          updated_at = now();
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.detect_growth_from_metric() from public, anon, authenticated;

drop trigger if exists detect_growth_from_metric on public.metric_snapshots;
create trigger detect_growth_from_metric
after insert or update of views, reach, saves, playlist_adds, follows, listeners, streams, release_id, content_item_id on public.metric_snapshots
for each row execute function private.detect_growth_from_metric();

create or replace function private.refresh_release_growth_risk(p_release_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  content_count integer;
  ready_count integer;
  days_remaining integer;
begin
  if p_release_id is null then return; end if;

  select id, owner_id, title, status::text as status, release_date
  into r
  from public.releases
  where id = p_release_id;

  if not found then return; end if;

  if r.status <> 'Scheduled' or r.release_date is null or r.release_date < current_date or r.release_date > current_date + 21 then
    update public.growth_opportunities
    set status = 'expired', updated_at = now()
    where owner_id = r.owner_id and dedupe_key = 'risk:' || r.id and status = 'new';
    return;
  end if;

  select
    count(*),
    count(*) filter (where asset_url is not null or status::text in ('Ready','Scheduled','Published'))
  into content_count, ready_count
  from public.content_items
  where owner_id = r.owner_id and release_id = r.id and status::text <> 'Archived';

  days_remaining := r.release_date - current_date;

  if content_count < 4 or ready_count < 2 then
    insert into public.growth_opportunities (
      owner_id, kind, release_id, title, rationale, priority, confidence,
      evidence, recommended_action, dedupe_key, status, detected_at
    ) values (
      r.owner_id,
      'release_risk',
      r.id,
      r.title || ' has a launch-readiness risk',
      format('%s days remain, but only %s content moments exist and %s have a usable asset/readiness signal.', days_remaining, content_count, ready_count),
      least(96, greatest(70, 92 - days_remaining)),
      0.94,
      jsonb_build_object('daysUntilRelease', days_remaining, 'contentMoments', content_count, 'readyMoments', ready_count),
      jsonb_build_object('type', 'finish_release_plan', 'minimumContentMoments', 4),
      'risk:' || r.id,
      'new',
      now()
    )
    on conflict (owner_id, dedupe_key) do update set
      title = excluded.title,
      rationale = excluded.rationale,
      priority = excluded.priority,
      confidence = excluded.confidence,
      evidence = excluded.evidence,
      recommended_action = excluded.recommended_action,
      detected_at = excluded.detected_at,
      status = case when public.growth_opportunities.status in ('dismissed','completed') then public.growth_opportunities.status else 'new' end,
      updated_at = now();
  else
    update public.growth_opportunities
    set status = 'expired', updated_at = now()
    where owner_id = r.owner_id and dedupe_key = 'risk:' || r.id and status = 'new';
  end if;
end;
$$;

revoke all on function private.refresh_release_growth_risk(uuid) from public, anon, authenticated;

create or replace function private.refresh_release_growth_risk_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'releases' then
    perform private.refresh_release_growth_risk(coalesce(new.id, old.id));
  else
    if tg_op = 'DELETE' then
      perform private.refresh_release_growth_risk(old.release_id);
    else
      perform private.refresh_release_growth_risk(new.release_id);
      if tg_op = 'UPDATE' and old.release_id is distinct from new.release_id then
        perform private.refresh_release_growth_risk(old.release_id);
      end if;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.refresh_release_growth_risk_trigger() from public, anon, authenticated;

drop trigger if exists refresh_release_growth_risk_from_release on public.releases;
create trigger refresh_release_growth_risk_from_release
after insert or update of release_date, status on public.releases
for each row execute function private.refresh_release_growth_risk_trigger();

drop trigger if exists refresh_release_growth_risk_from_content on public.content_items;
create trigger refresh_release_growth_risk_from_content
after insert or update or delete on public.content_items
for each row execute function private.refresh_release_growth_risk_trigger();

-- Build the initial plan and risk state for current owners without requiring a page visit.
do $$
declare
  owner_value uuid;
  release_value uuid;
begin
  for owner_value in select distinct owner_id from public.track_vault loop
    perform private.rebuild_growth_plan(owner_value);
  end loop;
  for release_value in select id from public.releases loop
    perform private.refresh_release_growth_risk(release_value);
  end loop;
end $$;
