-- Artist AI capability enforcement at provider/provenance boundaries.
--
-- UI visibility is never the security boundary. These guards make artist policy
-- authoritative even when a deep link, stale browser tab, worker or future action
-- reaches an existing generation path directly.

create or replace function private.artist_ai_capability_allowed(
  target_artist_id uuid,
  capability text
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  project_type text;
  profile public.artist_operating_profiles%rowtype;
  default_ai_native boolean;
begin
  select a.project_type into project_type
  from public.artists a
  where a.id = target_artist_id;

  if project_type is null then
    return false;
  end if;

  select p.* into profile
  from public.artist_operating_profiles p
  where p.artist_id = target_artist_id;

  default_ai_native := project_type in ('ai_assisted', 'hybrid', 'virtual_persona');

  if capability = 'writing' then
    return coalesce(profile.ai_writing_allowed, true);
  elsif capability = 'visuals' then
    return coalesce(profile.ai_visuals_allowed, default_ai_native);
  elsif capability = 'music' then
    return coalesce(profile.ai_music_allowed, default_ai_native);
  elsif capability = 'voice' then
    return coalesce(profile.ai_voice_allowed, false);
  elsif capability = 'likeness' then
    return coalesce(profile.ai_likeness_allowed, false);
  end if;

  return false;
end
$$;

revoke all on function private.artist_ai_capability_allowed(uuid, text) from public, anon, authenticated;

create or replace function private.generation_run_artist_id(candidate public.generation_runs)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resolved_artist_id uuid;
begin
  if candidate.artist_id is not null then
    return candidate.artist_id;
  end if;

  if candidate.release_id is not null then
    select r.artist_id into resolved_artist_id
    from public.releases r
    where r.id = candidate.release_id and r.owner_id = candidate.owner_id;
    if resolved_artist_id is not null then return resolved_artist_id; end if;
  end if;

  if candidate.campaign_id is not null then
    select c.artist_id into resolved_artist_id
    from public.campaigns c
    where c.id = candidate.campaign_id and c.owner_id = candidate.owner_id;
    if resolved_artist_id is not null then return resolved_artist_id; end if;
  end if;

  if candidate.video_project_id is not null then
    select r.artist_id into resolved_artist_id
    from public.music_video_projects p
    join public.releases r on r.id = p.release_id and r.owner_id = p.owner_id
    where p.id = candidate.video_project_id and p.owner_id = candidate.owner_id;
  end if;

  return resolved_artist_id;
end
$$;

revoke all on function private.generation_run_artist_id(public.generation_runs) from public, anon, authenticated;

create or replace function private.enforce_generation_run_artist_ai_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_artist_id uuid;
begin
  target_artist_id := private.generation_run_artist_id(new);
  if target_artist_id is null then
    return new;
  end if;

  -- Text/reasoning tasks create their provenance row before the gateway call, so
  -- rejecting the insert prevents the model request itself, including cache aliases.
  if new.task_type is not null
     and not private.artist_ai_capability_allowed(target_artist_id, 'writing') then
    raise exception 'AI writing is disabled for this artist. Enable it explicitly in Artist Profile.';
  end if;

  -- Marketing image/video generations are prepared as content_asset runs before
  -- spend approval. Block preparation for artists that do not allow generative visuals.
  if new.purpose like 'content_asset:%'
     and not private.artist_ai_capability_allowed(target_artist_id, 'visuals') then
    raise exception 'Generative visuals are disabled for this artist. Use source media or enable them explicitly in Artist Profile.';
  end if;

  return new;
end
$$;

revoke all on function private.enforce_generation_run_artist_ai_policy() from public, anon, authenticated;

drop trigger if exists enforce_generation_run_artist_ai_policy on public.generation_runs;
create trigger enforce_generation_run_artist_ai_policy
  before insert on public.generation_runs
  for each row execute function private.enforce_generation_run_artist_ai_policy();

create or replace function private.enforce_music_video_artist_ai_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_artist_id uuid;
  should_check boolean := false;
begin
  -- Every Video Director generation is synthetic provider work. Block even planned
  -- records when visuals are off so the UI cannot drift into a generative workflow.
  if tg_op = 'INSERT' then
    should_check := true;
  elsif tg_op = 'UPDATE'
     and new.status = 'approved'
     and new.billing_status = 'reserved'
     and (old.status is distinct from new.status or old.billing_status is distinct from new.billing_status) then
    -- reserve_music_video_generation reaches this transition immediately before
    -- Higgsfield is called. Re-check policy to cover a setting changed after planning.
    should_check := true;
  end if;

  if should_check then
    select r.artist_id into target_artist_id
    from public.music_video_projects p
    join public.releases r on r.id = p.release_id and r.owner_id = p.owner_id
    where p.id = new.project_id and p.owner_id = new.owner_id;

    if target_artist_id is null then
      raise exception 'Cannot resolve artist policy for this video generation.';
    end if;
    if not private.artist_ai_capability_allowed(target_artist_id, 'visuals') then
      raise exception 'Generative visuals are disabled for this artist. Use source media or enable them explicitly in Artist Profile.';
    end if;
  end if;

  return new;
end
$$;

revoke all on function private.enforce_music_video_artist_ai_policy() from public, anon, authenticated;

drop trigger if exists enforce_music_video_artist_ai_policy on public.music_video_generations;
create trigger enforce_music_video_artist_ai_policy
  before insert or update of status, billing_status on public.music_video_generations
  for each row execute function private.enforce_music_video_artist_ai_policy();
