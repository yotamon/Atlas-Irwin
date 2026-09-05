-- Ensemblis artist-first activation telemetry.
-- Product state remains canonical; this append-only stream records only first-occurrence milestones
-- so activation time and abandonment can be measured without a parallel onboarding checklist.

create table public.artist_activation_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  event_type text not null check (event_type in (
    'onboarding_started',
    'artist_identity_confirmed',
    'first_music_added',
    'first_intelligence_ready',
    'first_release_mission',
    'first_moment_curated',
    'first_moment_approved',
    'first_useful_recommendation',
    'onboarding_dismissed'
  )),
  source_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (artist_id, event_type)
);

create index artist_activation_events_owner_artist_idx
  on public.artist_activation_events(owner_id, artist_id, occurred_at);

create or replace function private.record_artist_activation_event(
  p_owner_id uuid,
  p_artist_id uuid,
  p_event_type text,
  p_source_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event_type not in (
    'onboarding_started','artist_identity_confirmed','first_music_added','first_intelligence_ready',
    'first_release_mission','first_moment_curated','first_moment_approved',
    'first_useful_recommendation','onboarding_dismissed'
  ) then raise exception 'Unsupported activation event'; end if;

  if not exists (
    select 1 from public.artists a
    join public.workspace_memberships membership on membership.workspace_id = a.workspace_id
    where a.id = p_artist_id
      and membership.profile_id = p_owner_id
      and membership.status = 'active'
  ) then raise exception 'Activation event artist scope mismatch'; end if;

  insert into public.artist_activation_events(owner_id, artist_id, event_type, source_id, metadata)
  values (p_owner_id, p_artist_id, p_event_type, p_source_id, coalesce(p_metadata, '{}'::jsonb))
  on conflict (artist_id, event_type) do nothing;
end;
$$;
revoke all on function private.record_artist_activation_event(uuid,uuid,text,uuid,jsonb) from public, anon, authenticated;

-- Artist identity is the only setup fact requested before music, and only when the bootstrap
-- identity generated from the account is not the real project identity.
create or replace function public.confirm_ensemblis_artist_identity(
  p_artist_id uuid,
  p_name text,
  p_project_type text default 'human'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_workspace_id uuid;
  v_workspace_kind text;
  v_workspace_created_by uuid;
  v_role text;
  v_base_slug text;
  v_slug text;
  v_index integer := 1;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_name,''))) < 1 or char_length(btrim(p_name)) > 120 then
    raise exception 'Artist name must be between 1 and 120 characters';
  end if;
  if p_project_type not in ('human','ai_assisted','hybrid','virtual_persona') then
    raise exception 'Unsupported artist project type';
  end if;

  select a.workspace_id, w.kind, w.created_by, membership.role
    into v_workspace_id, v_workspace_kind, v_workspace_created_by, v_role
  from public.artists a
  join public.workspaces w on w.id = a.workspace_id
  join public.workspace_memberships membership
    on membership.workspace_id = a.workspace_id
   and membership.profile_id = v_user
   and membership.status = 'active'
  where a.id = p_artist_id and a.status = 'active';

  if v_workspace_id is null then raise exception 'Artist not found'; end if;
  if v_role not in ('owner','admin') then raise exception 'Only workspace owners or admins can change artist identity'; end if;

  v_base_slug := private.ensemblis_slugify(p_name);
  v_slug := v_base_slug;
  while exists (
    select 1 from public.artists
    where workspace_id = v_workspace_id and slug = v_slug and id <> p_artist_id
  ) loop
    v_index := v_index + 1;
    v_slug := left(v_base_slug, greatest(1, 70 - char_length(v_index::text) - 1)) || '-' || v_index::text;
  end loop;

  update public.artists
  set name = btrim(p_name), slug = v_slug, project_type = p_project_type, updated_at = now()
  where id = p_artist_id;

  -- Rename only the bootstrap personal workspace owned by this same account. Team/label
  -- workspaces keep their independent organization identity.
  if v_workspace_kind = 'personal' and v_workspace_created_by = v_user then
    update public.workspaces
    set name = btrim(p_name) || ' Workspace', updated_at = now()
    where id = v_workspace_id;
  end if;

  perform private.record_artist_activation_event(v_user, p_artist_id, 'artist_identity_confirmed', p_artist_id,
    jsonb_build_object('project_type', p_project_type));
  return p_artist_id;
end;
$$;
revoke all on function public.confirm_ensemblis_artist_identity(uuid,text,text) from public, anon;
grant execute on function public.confirm_ensemblis_artist_identity(uuid,text,text) to authenticated;

create or replace function public.record_ensemblis_activation_ui_event(
  p_artist_id uuid,
  p_event_type text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_event_type not in ('onboarding_started','onboarding_dismissed') then
    raise exception 'Unsupported client activation event';
  end if;
  perform private.record_artist_activation_event(v_user, p_artist_id, p_event_type, null, '{}'::jsonb);
end;
$$;
revoke all on function public.record_ensemblis_activation_ui_event(uuid,text) from public, anon;
grant execute on function public.record_ensemblis_activation_ui_event(uuid,text) to authenticated;

create or replace function private.capture_track_vault_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer := 0;
begin
  if tg_op = 'INSERT' and new.audio_url is not null then
    perform private.record_artist_activation_event(new.owner_id, new.artist_id, 'first_music_added', new.id,
      jsonb_build_object('source', coalesce(new.source,'unknown')));
  end if;

  if coalesce(new.audio_profile->>'source','') = 'worker'
     and coalesce(new.audio_profile->>'version','') ~ '^[0-9]+$' then
    v_version := (new.audio_profile->>'version')::integer;
  end if;
  if v_version >= 3 then
    perform private.record_artist_activation_event(new.owner_id, new.artist_id, 'first_intelligence_ready', new.id,
      jsonb_build_object('analysis_version', v_version));
  end if;
  return new;
end;
$$;
revoke all on function private.capture_track_vault_activation() from public, anon, authenticated;
create trigger capture_track_vault_activation
  after insert or update of audio_profile on public.track_vault
  for each row execute function private.capture_track_vault_activation();

create or replace function private.capture_release_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.record_artist_activation_event(new.owner_id, new.artist_id, 'first_release_mission', new.id,
    jsonb_build_object('status', new.status));
  -- A newly created Release Mission always yields a deterministic next action from canonical release
  -- state, so this is the first point at which Ensemblis can make a useful Mission recommendation.
  perform private.record_artist_activation_event(new.owner_id, new.artist_id, 'first_useful_recommendation', new.id,
    jsonb_build_object('source', 'release_mission'));
  return new;
end;
$$;
revoke all on function private.capture_release_activation() from public, anon, authenticated;
create trigger capture_release_activation
  after insert on public.releases
  for each row execute function private.capture_release_activation();

create or replace function private.capture_moment_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.state in ('proposed','approved') then
      perform private.record_artist_activation_event(new.owner_id, new.artist_id, 'first_moment_curated', new.id,
        jsonb_build_object('source_mode', new.source_mode));
    end if;
    if new.state = 'approved' then
      perform private.record_artist_activation_event(new.owner_id, new.artist_id, 'first_moment_approved', new.id,
        jsonb_build_object('source_mode', new.source_mode));
    end if;
  elsif tg_op = 'UPDATE' and new.state = 'approved' and old.state is distinct from 'approved' then
    perform private.record_artist_activation_event(new.owner_id, new.artist_id, 'first_moment_approved', new.id,
      jsonb_build_object('source_mode', new.source_mode));
  end if;
  return new;
end;
$$;
revoke all on function private.capture_moment_activation() from public, anon, authenticated;
create trigger capture_moment_activation
  after insert or update of state on public.moments
  for each row execute function private.capture_moment_activation();

-- Backfill milestones for existing artists without inventing UI-start/dismiss events.
do $$
declare row record; v_version integer;
begin
  for row in select owner_id, artist_id, id, source from public.track_vault where audio_url is not null loop
    perform private.record_artist_activation_event(row.owner_id,row.artist_id,'first_music_added',row.id,jsonb_build_object('source',coalesce(row.source,'unknown')));
  end loop;
  for row in select owner_id, artist_id, id, audio_profile from public.track_vault
    where coalesce(audio_profile->>'source','')='worker' loop
    v_version := case when coalesce(row.audio_profile->>'version','') ~ '^[0-9]+$' then (row.audio_profile->>'version')::integer else 0 end;
    if v_version >= 3 then
      perform private.record_artist_activation_event(row.owner_id,row.artist_id,'first_intelligence_ready',row.id,jsonb_build_object('analysis_version',v_version));
    end if;
  end loop;
  for row in select owner_id, artist_id, id, status from public.releases loop
    perform private.record_artist_activation_event(row.owner_id,row.artist_id,'first_release_mission',row.id,jsonb_build_object('status',row.status));
    perform private.record_artist_activation_event(row.owner_id,row.artist_id,'first_useful_recommendation',row.id,jsonb_build_object('source','release_mission'));
  end loop;
  for row in select owner_id, artist_id, id, state, source_mode from public.moments where state in ('proposed','approved') loop
    perform private.record_artist_activation_event(row.owner_id,row.artist_id,'first_moment_curated',row.id,jsonb_build_object('source_mode',row.source_mode));
    if row.state='approved' then
      perform private.record_artist_activation_event(row.owner_id,row.artist_id,'first_moment_approved',row.id,jsonb_build_object('source_mode',row.source_mode));
    end if;
  end loop;
end $$;

alter table public.artist_activation_events enable row level security;
revoke all on public.artist_activation_events from anon, authenticated;
grant select on public.artist_activation_events to authenticated;
create policy artist_activation_events_select on public.artist_activation_events
  for select to authenticated
  using (owner_id = auth.uid() and private.can_access_artist(artist_id));

revoke all on public.artist_activation_events from service_role;
grant all on public.artist_activation_events to service_role;

comment on table public.artist_activation_events is
  'Append-only first-occurrence activation telemetry. Real product state, not this table, decides what onboarding should show next.';