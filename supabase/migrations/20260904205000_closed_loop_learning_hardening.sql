-- Ensemblis closed-loop learning hardening
--
-- Keep #50 compatible with the existing artist-inference triggers and make an
-- approved decision contract immutable until a later proposal explicitly
-- supersedes it.

create or replace function private.guard_marketing_learning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_id uuid;
begin
  if not private.is_valid_marketing_learning_effect(new.effect) then
    raise exception 'Learning effect is not a supported Ensemblis decision contract';
  end if;

  -- Approval is a human decision over an exact evidence/effect snapshot. Provider
  -- refreshes may continue discovering new evidence, but they must never mutate an
  -- already-approved rule in place. A changed conclusion becomes a new proposal
  -- and supersedes the old rule only after another explicit approval.
  if tg_op = 'UPDATE' and old.status = 'approved' and new.status = 'approved' then
    new.finding := old.finding;
    new.evidence := old.evidence;
    new.confidence := old.confidence;
    new.applies_to := old.applies_to;
    new.source := old.source;
    new.learning_key := old.learning_key;
    new.learning_family_key := old.learning_family_key;
    new.effect_version := old.effect_version;
    new.effect := old.effect;
    new.evidence_sample_size := old.evidence_sample_size;
    new.evidence_window_start := old.evidence_window_start;
    new.evidence_window_end := old.evidence_window_end;
    new.last_evidence_at := old.last_evidence_at;
    new.expires_at := old.expires_at;
    new.supersedes_learning_id := old.supersedes_learning_id;
    new.approved_at := old.approved_at;
    new.updated_at := old.updated_at;
    return new;
  end if;

  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if new.effect <> '{}'::jsonb and new.expires_at is not null and new.expires_at <= now() then
      raise exception 'Expired learning evidence cannot become an active decision rule';
    end if;

    if new.learning_family_key is not null then
      select ml.id
        into v_previous_id
      from public.marketing_learnings ml
      where ml.artist_id = new.artist_id
        and ml.learning_family_key = new.learning_family_key
        and ml.status = 'approved'
        and ml.id <> new.id
      order by ml.approved_at desc nulls last, ml.created_at desc
      limit 1;

      if v_previous_id is not null then
        update public.marketing_learnings
        set status = 'superseded', updated_at = now()
        where id = v_previous_id;
        new.supersedes_learning_id := coalesce(new.supersedes_learning_id, v_previous_id);
      end if;
    end if;

    new.approved_at := coalesce(new.approved_at, now());
  elsif new.status <> 'approved' and tg_op = 'UPDATE' and old.status = 'approved' then
    new.approved_at := null;
  end if;

  return new;
end;
$$;

-- The legacy/product bootstrap can still insert generated content without an
-- explicit artist_id and let the canonical operational trigger infer it. Resolve
-- the same canonical parent before Moment selection so #50 never depends on
-- alphabetical trigger order.
create or replace function private.attach_preferred_moment_to_generated_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moment public.moments%rowtype;
  v_artist_id uuid;
begin
  if new.artist_id is null then
    if new.release_id is not null then
      select r.artist_id into v_artist_id
      from public.releases r
      where r.id = new.release_id and r.owner_id = new.owner_id;
    end if;
    if v_artist_id is null and new.campaign_id is not null then
      select c.artist_id into v_artist_id
      from public.campaigns c
      where c.id = new.campaign_id and c.owner_id = new.owner_id;
    end if;
    if v_artist_id is not null then new.artist_id := v_artist_id; end if;
  end if;

  if new.moment_id is not null
     or new.release_id is null
     or new.artist_id is null
     or new.source not in ('planner','ai','automation') then
    return new;
  end if;

  select m.*
    into v_moment
  from public.moments m
  where m.owner_id = new.owner_id
    and m.artist_id = new.artist_id
    and m.release_id = new.release_id
    and m.state = 'approved'
    and m.superseded_by_id is null
  order by
    private.moment_execution_score(m.id, new.platform::text, new.format, new.goal) desc nulls last,
    m.confidence desc,
    m.created_at asc,
    m.id asc
  limit 1;

  if found then
    new.moment_id := v_moment.id;
    new.audio_timestamp_start := floor(v_moment.start_ms / 1000.0)::integer;
    new.audio_timestamp_end := ceil(v_moment.end_ms / 1000.0)::integer;
    new.audio_timestamp_source := 'moment';
    new.audio_timestamp_candidate_id := v_moment.source_candidate_id;
    new.audio_timestamp_analysis_version := v_moment.track_analysis_version;
  end if;

  return new;
end;
$$;

create or replace function private.attach_content_creative_recipe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.creative_recipes%rowtype;
  v_version integer := 1;
  v_needs_recipe boolean := false;
  v_artist_id uuid;
begin
  if new.source not in ('planner','ai','automation') and new.generated_from_run_id is null then
    return new;
  end if;

  if new.artist_id is null then
    if new.release_id is not null then
      select r.artist_id into v_artist_id
      from public.releases r
      where r.id = new.release_id and r.owner_id = new.owner_id;
    end if;
    if v_artist_id is null and new.campaign_id is not null then
      select c.artist_id into v_artist_id
      from public.campaigns c
      where c.id = new.campaign_id and c.owner_id = new.owner_id;
    end if;
    if v_artist_id is null and new.moment_id is not null then
      select m.artist_id into v_artist_id
      from public.moments m
      where m.id = new.moment_id and m.owner_id = new.owner_id;
    end if;
    if v_artist_id is not null then new.artist_id := v_artist_id; end if;
  end if;

  -- Truly legacy/unscoped generated rows remain compatible. Artist-scoped modern
  -- execution always resolves through release/campaign/Moment and gets a recipe.
  if new.artist_id is null then return new; end if;

  if tg_op = 'INSERT' then
    v_needs_recipe := new.creative_recipe_id is null;
  else
    v_needs_recipe := new.creative_recipe_id is null
      or new.moment_id is distinct from old.moment_id
      or new.content_angle is distinct from old.content_angle
      or new.audience_segment is distinct from old.audience_segment
      or new.hook_text is distinct from old.hook_text
      or new.caption is distinct from old.caption
      or new.cta is distinct from old.cta
      or new.visual_prompt is distinct from old.visual_prompt
      or new.production_notes is distinct from old.production_notes
      or new.platform is distinct from old.platform
      or new.format is distinct from old.format
      or new.goal is distinct from old.goal;
  end if;

  if not v_needs_recipe then return new; end if;

  if tg_op = 'UPDATE' and old.creative_recipe_id is not null then
    select * into v_parent from public.creative_recipes where id = old.creative_recipe_id;
    if found then v_version := v_parent.recipe_version + 1; end if;
  end if;

  insert into public.creative_recipes(
    owner_id,artist_id,release_id,campaign_id,moment_id,generation_run_id,parent_recipe_id,
    recipe_kind,recipe_version,recipe
  ) values (
    new.owner_id,new.artist_id,new.release_id,new.campaign_id,new.moment_id,new.generated_from_run_id,
    case when tg_op='UPDATE' then old.creative_recipe_id else null end,
    'content',v_version,
    jsonb_strip_nulls(jsonb_build_object(
      'platform', new.platform::text,
      'format', new.format,
      'goal', new.goal,
      'contentAngle', new.content_angle,
      'audienceSegment', new.audience_segment,
      'hookText', new.hook_text,
      'caption', new.caption,
      'cta', new.cta,
      'visualPrompt', new.visual_prompt,
      'productionNotes', new.production_notes,
      'source', new.source
    ))
  ) returning id into new.creative_recipe_id;

  return new;
end;
$$;

create or replace function private.attach_variant_creative_recipe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content record;
  v_parent public.creative_recipes%rowtype;
  v_version integer := 1;
  v_needs_recipe boolean := false;
begin
  if tg_op = 'INSERT' then
    v_needs_recipe := new.creative_recipe_id is null;
  else
    v_needs_recipe := new.creative_recipe_id is null
      or new.hypothesis is distinct from old.hypothesis
      or new.hook_text is distinct from old.hook_text
      or new.caption is distinct from old.caption
      or new.cta is distinct from old.cta
      or new.visual_prompt is distinct from old.visual_prompt
      or new.production_notes is distinct from old.production_notes;
  end if;
  if not v_needs_recipe then return new; end if;

  select ci.owner_id,ci.artist_id,ci.release_id,ci.campaign_id,ci.moment_id,ci.creative_recipe_id,
         ci.platform::text as platform,ci.format,ci.goal,ci.content_angle,ci.audience_segment
    into v_content
  from public.content_items ci
  where ci.id = new.content_item_id;
  if not found then raise exception 'Variant content item must exist before recipe lineage can be captured'; end if;
  if v_content.owner_id <> new.owner_id then
    raise exception 'Content variant owner must match content owner';
  end if;
  if new.artist_id is null then
    new.artist_id := v_content.artist_id;
  elsif new.artist_id <> v_content.artist_id then
    raise exception 'Content variant artist must match content artist';
  end if;

  if tg_op = 'UPDATE' and old.creative_recipe_id is not null then
    select * into v_parent from public.creative_recipes where id = old.creative_recipe_id;
    if found then v_version := v_parent.recipe_version + 1; end if;
  end if;

  insert into public.creative_recipes(
    owner_id,artist_id,release_id,campaign_id,moment_id,generation_run_id,parent_recipe_id,
    recipe_kind,recipe_version,recipe
  ) values (
    new.owner_id,v_content.artist_id,v_content.release_id,v_content.campaign_id,v_content.moment_id,new.generation_run_id,
    case when tg_op='UPDATE' and old.creative_recipe_id is not null then old.creative_recipe_id else v_content.creative_recipe_id end,
    'variant',v_version,
    jsonb_strip_nulls(jsonb_build_object(
      'platform', v_content.platform,
      'format', v_content.format,
      'goal', v_content.goal,
      'contentAngle', v_content.content_angle,
      'audienceSegment', v_content.audience_segment,
      'label', new.label,
      'hypothesis', new.hypothesis,
      'hookText', new.hook_text,
      'caption', new.caption,
      'cta', new.cta,
      'visualPrompt', new.visual_prompt,
      'productionNotes', new.production_notes,
      'isControl', new.is_control
    ))
  ) returning id into new.creative_recipe_id;

  return new;
end;
$$;

-- Keep canonical operational validation/inference first. PostgreSQL executes
-- same-timing triggers alphabetically, so the z-prefix snapshots lineage only
-- after the existing publication artist guard has accepted and normalized the row.
drop trigger if exists publication_jobs_snapshot_learning_lineage on public.publication_jobs;
drop trigger if exists z0_publication_jobs_snapshot_learning_lineage on public.publication_jobs;
create trigger z0_publication_jobs_snapshot_learning_lineage
before insert or update of content_item_id,content_variant_id on public.publication_jobs
for each row execute function private.snapshot_publication_learning_lineage();
