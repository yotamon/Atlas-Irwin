-- Ensemblis closed-loop creative lineage
--
-- A Moment explains which part of the music powered a creative. A creative recipe
-- explains what treatment Ensemblis applied to that Moment. Recipes are immutable
-- snapshots so later edits cannot rewrite the historical cause of an outcome.

create table if not exists public.creative_recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete restrict,
  release_id uuid references public.releases(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  moment_id uuid references public.moments(id) on delete restrict,
  generation_run_id uuid references public.generation_runs(id) on delete set null,
  parent_recipe_id uuid references public.creative_recipes(id) on delete set null,
  recipe_kind text not null check (recipe_kind in ('content','variant')),
  recipe_version integer not null default 1 check (recipe_version > 0),
  recipe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists creative_recipes_artist_created_idx
  on public.creative_recipes(artist_id, created_at desc);
create index if not exists creative_recipes_moment_idx
  on public.creative_recipes(moment_id)
  where moment_id is not null;

alter table public.creative_recipes enable row level security;

drop policy if exists "studio admins artist select creative_recipes" on public.creative_recipes;
create policy "studio admins artist select creative_recipes"
on public.creative_recipes for select to authenticated
using (private.is_studio_admin() and private.can_access_artist(artist_id));

drop policy if exists "studio admins artist insert creative_recipes" on public.creative_recipes;
create policy "studio admins artist insert creative_recipes"
on public.creative_recipes for insert to authenticated
with check (private.is_studio_admin() and private.can_access_artist(artist_id));

comment on table public.creative_recipes is
  'Immutable causal snapshots of a generated/adapted creative treatment. Content and publication lineage points here instead of reconstructing historical intent from mutable copy fields.';

alter table public.content_items
  add column if not exists creative_recipe_id uuid references public.creative_recipes(id) on delete restrict;
alter table public.content_variants
  add column if not exists creative_recipe_id uuid references public.creative_recipes(id) on delete restrict;
alter table public.publication_jobs
  add column if not exists moment_id uuid references public.moments(id) on delete restrict,
  add column if not exists creative_recipe_id uuid references public.creative_recipes(id) on delete restrict;

create index if not exists content_items_creative_recipe_idx on public.content_items(creative_recipe_id) where creative_recipe_id is not null;
create index if not exists content_variants_creative_recipe_idx on public.content_variants(creative_recipe_id) where creative_recipe_id is not null;
create index if not exists publication_jobs_moment_recipe_idx on public.publication_jobs(moment_id, creative_recipe_id) where moment_id is not null;

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
begin
  if new.source not in ('planner','ai','automation') and new.generated_from_run_id is null then
    return new;
  end if;

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

  if not v_needs_recipe then
    return new;
  end if;

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

-- Runs after the a0 Moment selector and before the generic music-intelligence
-- trigger, so the recipe snapshots the actual selected Moment.
drop trigger if exists a1_attach_content_creative_recipe on public.content_items;
create trigger a1_attach_content_creative_recipe
before insert or update of moment_id,content_angle,audience_segment,hook_text,caption,cta,visual_prompt,production_notes,platform,format,goal,source,generated_from_run_id
on public.content_items
for each row execute function private.attach_content_creative_recipe();

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
  if v_content.owner_id <> new.owner_id or v_content.artist_id <> new.artist_id then
    raise exception 'Variant recipe lineage must stay inside the content artist scope';
  end if;

  if tg_op = 'UPDATE' and old.creative_recipe_id is not null then
    select * into v_parent from public.creative_recipes where id = old.creative_recipe_id;
    if found then v_version := v_parent.recipe_version + 1; end if;
  end if;

  insert into public.creative_recipes(
    owner_id,artist_id,release_id,campaign_id,moment_id,generation_run_id,parent_recipe_id,
    recipe_kind,recipe_version,recipe
  ) values (
    new.owner_id,new.artist_id,v_content.release_id,v_content.campaign_id,v_content.moment_id,new.generation_run_id,
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

drop trigger if exists content_variants_attach_creative_recipe on public.content_variants;
create trigger content_variants_attach_creative_recipe
before insert or update of content_item_id,hypothesis,hook_text,caption,cta,visual_prompt,production_notes,generation_run_id
on public.content_variants
for each row execute function private.attach_variant_creative_recipe();

create or replace function private.snapshot_publication_learning_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moment_id uuid;
  v_recipe_id uuid;
  v_owner_id uuid;
  v_artist_id uuid;
begin
  if new.content_variant_id is not null then
    select ci.moment_id,cv.creative_recipe_id,ci.owner_id,ci.artist_id
      into v_moment_id,v_recipe_id,v_owner_id,v_artist_id
    from public.content_variants cv
    join public.content_items ci on ci.id=cv.content_item_id
    where cv.id=new.content_variant_id;
  elsif new.content_item_id is not null then
    select ci.moment_id,ci.creative_recipe_id,ci.owner_id,ci.artist_id
      into v_moment_id,v_recipe_id,v_owner_id,v_artist_id
    from public.content_items ci
    where ci.id=new.content_item_id;
  else
    return new;
  end if;

  if not found then raise exception 'Publication content lineage could not be resolved'; end if;
  if new.owner_id <> v_owner_id or new.artist_id <> v_artist_id then
    raise exception 'Publication lineage must stay inside the content artist scope';
  end if;

  new.moment_id := v_moment_id;
  new.creative_recipe_id := v_recipe_id;
  return new;
end;
$$;

drop trigger if exists publication_jobs_snapshot_learning_lineage on public.publication_jobs;
create trigger publication_jobs_snapshot_learning_lineage
before insert or update of content_item_id,content_variant_id on public.publication_jobs
for each row execute function private.snapshot_publication_learning_lineage();

-- Expose the creative cause alongside the musical cause. Existing view columns
-- stay in their original order so CREATE OR REPLACE is migration-replay safe;
-- creative lineage is appended as new columns.
create or replace view public.verified_moment_learning_evidence
with (security_invoker = true)
as
select
  ms.id as metric_snapshot_id,
  ms.owner_id,
  ms.artist_id,
  ms.content_item_id,
  ci.moment_id,
  m.track_id,
  m.release_id,
  ci.campaign_id,
  ci.platform::text as platform,
  ci.format,
  ci.goal,
  m.moment_type,
  m.label as moment_label,
  m.source_mode::text as source_mode,
  m.purpose_tags,
  m.confidence as moment_confidence,
  m.vocal_score,
  m.hook_score,
  m.emotional_score,
  m.energy_score,
  m.uniqueness_score,
  ms.source as metric_source,
  ms.external_object_id,
  ms.captured_at,
  ms.date,
  ms.reach,
  ms.views,
  ms.watch_time,
  ms.likes,
  ms.comments,
  ms.shares,
  ms.saves,
  ms.profile_visits,
  ms.follows,
  ms.link_clicks,
  ms.streams,
  ms.listeners,
  ms.playlist_adds,
  ms.content_variant_id,
  coalesce(cv.creative_recipe_id, ci.creative_recipe_id) as creative_recipe_id,
  cr.recipe as creative_recipe
from public.metric_snapshots ms
join public.content_items ci on ci.id = ms.content_item_id
left join public.content_variants cv
  on cv.id = ms.content_variant_id and cv.content_item_id = ci.id
join public.moments m on m.id = ci.moment_id
left join public.creative_recipes cr
  on cr.id = coalesce(cv.creative_recipe_id, ci.creative_recipe_id)
 and cr.owner_id = ci.owner_id
 and cr.artist_id = ci.artist_id
 and cr.moment_id = ci.moment_id
where ms.content_item_id is not null
  and ci.moment_id is not null
  and ms.source <> 'manual'
  and ms.external_object_id is not null
  and btrim(ms.external_object_id) <> ''
  and ms.owner_id = ci.owner_id
  and ci.owner_id = m.owner_id
  and ms.artist_id = ci.artist_id
  and ci.artist_id = m.artist_id
  and ci.release_id = m.release_id
  and (ms.release_id is null or ms.release_id = ci.release_id)
  and ms.platform = ci.platform
  and m.state = 'approved'
  and m.superseded_by_id is null;

grant select on public.verified_moment_learning_evidence to authenticated;

create or replace view public.verified_creative_learning_evidence
with (security_invoker = true)
as
select e.*
from public.verified_moment_learning_evidence e
where e.creative_recipe_id is not null
  and e.creative_recipe is not null;

grant select on public.verified_creative_learning_evidence to authenticated;

comment on view public.verified_creative_learning_evidence is
  'Provider-backed outcome evidence with immutable musical Moment and creative recipe causes attached.';
