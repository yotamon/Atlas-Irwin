-- Ensemblis Fan Graph.
-- Relationship memory is consent-aware, artist-scoped and intentionally data-minimal.
-- This model has no sensitive-trait columns, browser fingerprints, probabilistic identity scores
-- or fuzzy cross-platform matching. Cross-channel merges require explicit/verified evidence.

create table public.fan_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  display_name text,
  relationship_state text not null default 'new'
    check (relationship_state in ('new','returning','known_supporter','inactive')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  interaction_count integer not null default 0 check (interaction_count >= 0),
  merged_into_fan_id uuid references public.fan_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (merged_into_fan_id is null or merged_into_fan_id <> id)
);

create table public.fan_identities (
  id uuid primary key default gen_random_uuid(),
  fan_id uuid not null references public.fan_profiles(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  channel text not null check (channel in ('instagram','youtube','tiktok','email','sms')),
  identifier_kind text not null
    check (identifier_kind in ('platform_handle','provider_subject','verified_email','verified_phone')),
  external_subject_id text not null check (char_length(external_subject_id) between 1 and 500),
  handle text,
  display_name text,
  evidence_level text not null default 'observed'
    check (evidence_level in ('observed','verified','explicit')),
  verified_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_id, channel, identifier_kind, external_subject_id)
);

create table public.fan_permissions (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.fan_identities(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  channel text not null check (channel in ('instagram','youtube','tiktok','email','sms')),
  purpose text not null
    check (purpose in ('proactive_updates','release_marketing','email_marketing','sms_marketing')),
  status text not null default 'unknown' check (status in ('unknown','granted','revoked')),
  source text not null default 'artist_record'
    check (source in ('artist_record','fan_opt_in','provider_sync','privacy_request')),
  evidence_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (identity_id, purpose)
);

create table public.fan_interaction_links (
  interaction_id uuid primary key references public.audience_interactions(id) on delete cascade,
  identity_id uuid not null references public.fan_identities(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  linked_at timestamptz not null default now()
);

-- Fan IDs here are audit identifiers, intentionally not foreign keys. A privacy deletion must not
-- be blocked by historical merge evidence and must not erase that a merge decision once happened.
create table public.fan_merge_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  source_fan_id uuid not null,
  target_fan_id uuid not null,
  evidence_type text not null
    check (evidence_type in ('explicit_confirmation','verified_contact_match','provider_verified_link')),
  evidence_note text not null check (char_length(evidence_note) between 3 and 1000),
  moved_identity_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'active' check (status in ('active','reverted','privacy_deleted')),
  merged_at timestamptz not null default now(),
  reverted_at timestamptz,
  created_at timestamptz not null default now(),
  check (source_fan_id <> target_fan_id)
);

create table public.fan_privacy_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  fan_id uuid not null,
  request_type text not null check (request_type in ('export','revoke','delete')),
  channel text,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index fan_profiles_artist_recent_idx
  on public.fan_profiles(owner_id, artist_id, last_seen_at desc)
  where merged_into_fan_id is null;
create index fan_identities_fan_idx on public.fan_identities(fan_id, last_seen_at desc);
create index fan_permissions_artist_idx on public.fan_permissions(owner_id, artist_id, status, purpose);
create index fan_merge_events_artist_idx on public.fan_merge_events(owner_id, artist_id, created_at desc);
create index fan_privacy_events_artist_idx on public.fan_privacy_events(owner_id, artist_id, created_at desc);

create trigger set_fan_profiles_updated_at
  before update on public.fan_profiles for each row execute function private.set_updated_at();
create trigger set_fan_identities_updated_at
  before update on public.fan_identities for each row execute function private.set_updated_at();
create trigger set_fan_permissions_updated_at
  before update on public.fan_permissions for each row execute function private.set_updated_at();

create or replace function private.validate_fan_child_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_artist uuid;
  v_channel text;
begin
  if tg_table_name = 'fan_identities' then
    select owner_id, artist_id into v_owner, v_artist
    from public.fan_profiles where id = new.fan_id and merged_into_fan_id is null;
  elsif tg_table_name = 'fan_permissions' then
    select owner_id, artist_id, channel into v_owner, v_artist, v_channel
    from public.fan_identities where id = new.identity_id;
    if v_channel is null or new.channel <> v_channel then
      raise exception 'Fan permission channel must match its identity channel';
    end if;
  elsif tg_table_name = 'fan_interaction_links' then
    select owner_id, artist_id into v_owner, v_artist
    from public.fan_identities where id = new.identity_id;
    if not exists (
      select 1 from public.audience_interactions i
      where i.id = new.interaction_id
        and i.owner_id = new.owner_id
        and i.artist_id = new.artist_id
    ) then
      raise exception 'Fan interaction link must match the interaction artist';
    end if;
  end if;

  if v_owner is null or v_artist is null or v_owner <> new.owner_id or v_artist <> new.artist_id then
    raise exception '% must match its canonical parent owner and artist', tg_table_name;
  end if;
  perform private.assert_operational_artist_owner(new.owner_id, new.artist_id);
  return new;
end;
$$;
revoke all on function private.validate_fan_child_scope() from public, anon, authenticated;

create trigger fan_identities_validate_scope
  before insert or update on public.fan_identities
  for each row execute function private.validate_fan_child_scope();
create trigger fan_permissions_validate_scope
  before insert or update on public.fan_permissions
  for each row execute function private.validate_fan_child_scope();
create trigger fan_interaction_links_validate_scope
  before insert or update on public.fan_interaction_links
  for each row execute function private.validate_fan_child_scope();

-- Same-platform repeated handles can maintain one channel identity. This is not a cross-channel
-- merge, and a matching handle on another platform never implies that it is the same person.
create or replace function private.link_fan_interaction(p_interaction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_interaction record;
  v_subject text;
  v_identity_id uuid;
  v_fan_id uuid;
  v_link_count integer := 0;
begin
  select id, owner_id, artist_id, platform, author_handle, author_name, occurred_at
  into v_interaction
  from public.audience_interactions
  where id = p_interaction_id;

  if v_interaction.id is null
    or v_interaction.artist_id is null
    or nullif(btrim(coalesce(v_interaction.author_handle, '')), '') is null then
    return;
  end if;
  if v_interaction.platform not in ('instagram','youtube','tiktok') then return; end if;

  v_subject := lower(regexp_replace(btrim(v_interaction.author_handle), '^@', ''));
  select id, fan_id into v_identity_id, v_fan_id
  from public.fan_identities
  where artist_id = v_interaction.artist_id
    and channel = v_interaction.platform
    and identifier_kind = 'platform_handle'
    and external_subject_id = v_subject;

  if v_identity_id is null then
    insert into public.fan_profiles(
      owner_id, artist_id, display_name, first_seen_at, last_seen_at, interaction_count
    ) values (
      v_interaction.owner_id,
      v_interaction.artist_id,
      nullif(btrim(coalesce(v_interaction.author_name, '')), ''),
      v_interaction.occurred_at,
      v_interaction.occurred_at,
      0
    ) returning id into v_fan_id;

    insert into public.fan_identities(
      fan_id, owner_id, artist_id, channel, identifier_kind, external_subject_id,
      handle, display_name, evidence_level, first_seen_at, last_seen_at
    ) values (
      v_fan_id, v_interaction.owner_id, v_interaction.artist_id, v_interaction.platform,
      'platform_handle', v_subject, v_interaction.author_handle, v_interaction.author_name,
      'observed', v_interaction.occurred_at, v_interaction.occurred_at
    ) returning id into v_identity_id;
  else
    update public.fan_identities
    set handle = coalesce(v_interaction.author_handle, handle),
        display_name = coalesce(v_interaction.author_name, display_name),
        last_seen_at = greatest(last_seen_at, v_interaction.occurred_at)
    where id = v_identity_id;
  end if;

  insert into public.fan_interaction_links(interaction_id, identity_id, owner_id, artist_id)
  values(v_interaction.id, v_identity_id, v_interaction.owner_id, v_interaction.artist_id)
  on conflict (interaction_id) do nothing;
  get diagnostics v_link_count = row_count;

  if v_link_count > 0 then
    update public.fan_profiles
    set interaction_count = interaction_count + 1,
        last_seen_at = greatest(last_seen_at, v_interaction.occurred_at),
        relationship_state = case
          when relationship_state = 'new' and interaction_count + 1 >= 2 then 'returning'
          else relationship_state
        end,
        display_name = coalesce(display_name, nullif(btrim(coalesce(v_interaction.author_name, '')), ''))
    where id = v_fan_id;
  end if;
end;
$$;
revoke all on function private.link_fan_interaction(uuid) from public, anon, authenticated;

create or replace function private.audience_interaction_to_fan_graph()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.link_fan_interaction(new.id);
  return new;
end;
$$;
revoke all on function private.audience_interaction_to_fan_graph() from public, anon, authenticated;

create trigger audience_interactions_link_fan_graph
  after insert on public.audience_interactions
  for each row execute function private.audience_interaction_to_fan_graph();

-- Backfill only same-platform observed handles. No fuzzy or cross-channel matching occurs.
do $$
declare
  r record;
begin
  for r in
    select id from public.audience_interactions
    where artist_id is not null and nullif(btrim(coalesce(author_handle, '')), '') is not null
  loop
    perform private.link_fan_interaction(r.id);
  end loop;
end $$;

create or replace function public.merge_fan_profiles(
  p_source_fan_id uuid,
  p_target_fan_id uuid,
  p_evidence_type text,
  p_evidence_note text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_artist uuid;
  v_target_owner uuid;
  v_target_artist uuid;
  v_moved uuid[];
  v_event uuid;
begin
  if p_source_fan_id = p_target_fan_id then raise exception 'Choose two different fan profiles'; end if;
  if p_evidence_type not in ('explicit_confirmation','verified_contact_match','provider_verified_link') then
    raise exception 'Merge requires explicit or verified identity evidence';
  end if;
  if char_length(btrim(coalesce(p_evidence_note, ''))) < 3 then
    raise exception 'Describe the evidence used for this merge';
  end if;

  select owner_id, artist_id into v_owner, v_artist
  from public.fan_profiles
  where id = p_source_fan_id and owner_id = (select auth.uid()) and merged_into_fan_id is null;
  select owner_id, artist_id into v_target_owner, v_target_artist
  from public.fan_profiles
  where id = p_target_fan_id and owner_id = (select auth.uid()) and merged_into_fan_id is null;

  if v_owner is null or v_target_owner is null
    or v_owner <> v_target_owner or v_artist <> v_target_artist
    or not private.can_access_artist(v_artist) then
    raise exception 'Fan profiles must belong to the same active artist';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_moved
  from public.fan_identities where fan_id = p_source_fan_id;

  update public.fan_identities set fan_id = p_target_fan_id where fan_id = p_source_fan_id;
  update public.fan_profiles set merged_into_fan_id = p_target_fan_id where id = p_source_fan_id;

  update public.fan_profiles f
  set interaction_count = (
        select count(*) from public.fan_interaction_links l
        join public.fan_identities i on i.id = l.identity_id where i.fan_id = f.id
      ),
      first_seen_at = coalesce((select min(i.first_seen_at) from public.fan_identities i where i.fan_id = f.id), f.first_seen_at),
      last_seen_at = coalesce((select max(i.last_seen_at) from public.fan_identities i where i.fan_id = f.id), f.last_seen_at),
      relationship_state = case
        when (select count(*) from public.fan_interaction_links l join public.fan_identities i on i.id=l.identity_id where i.fan_id=f.id) >= 2
          and f.relationship_state = 'new' then 'returning'
        else f.relationship_state
      end
  where f.id = p_target_fan_id;

  insert into public.fan_merge_events(
    owner_id, artist_id, source_fan_id, target_fan_id,
    evidence_type, evidence_note, moved_identity_ids
  ) values (
    v_owner, v_artist, p_source_fan_id, p_target_fan_id,
    p_evidence_type, btrim(p_evidence_note), v_moved
  ) returning id into v_event;
  return v_event;
end;
$$;

create or replace function public.revert_fan_merge(p_merge_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event record;
begin
  select * into v_event
  from public.fan_merge_events
  where id = p_merge_id and owner_id = (select auth.uid()) and status = 'active';
  if v_event.id is null or not private.can_access_artist(v_event.artist_id) then
    raise exception 'Active merge not found';
  end if;
  if not exists (select 1 from public.fan_profiles where id = v_event.source_fan_id)
    or not exists (select 1 from public.fan_profiles where id = v_event.target_fan_id) then
    raise exception 'This merge can no longer be reverted because a privacy deletion removed a profile';
  end if;

  update public.fan_identities
  set fan_id = v_event.source_fan_id
  where id = any(v_event.moved_identity_ids) and fan_id = v_event.target_fan_id;
  update public.fan_profiles set merged_into_fan_id = null where id = v_event.source_fan_id;

  update public.fan_profiles f
  set interaction_count = (
    select count(*) from public.fan_interaction_links l
    join public.fan_identities i on i.id = l.identity_id where i.fan_id = f.id
  )
  where f.id in (v_event.source_fan_id, v_event.target_fan_id);

  update public.fan_merge_events
  set status = 'reverted', reverted_at = now()
  where id = p_merge_id;
end;
$$;

create or replace function public.record_fan_export(p_fan_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_artist uuid;
  v_identity_count integer;
begin
  select owner_id, artist_id into v_owner, v_artist
  from public.fan_profiles
  where id = p_fan_id and owner_id = (select auth.uid()) and merged_into_fan_id is null;
  if v_owner is null or not private.can_access_artist(v_artist) then raise exception 'Fan profile not found'; end if;
  select count(*) into v_identity_count from public.fan_identities where fan_id = p_fan_id;
  insert into public.fan_privacy_events(owner_id, artist_id, fan_id, request_type, result_summary)
  values(v_owner, v_artist, p_fan_id, 'export', jsonb_build_object('identityCount', v_identity_count));
end;
$$;

create or replace function public.revoke_fan_permissions(p_fan_id uuid, p_channel text default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_artist uuid;
  v_count integer := 0;
begin
  select owner_id, artist_id into v_owner, v_artist
  from public.fan_profiles
  where id = p_fan_id and owner_id = (select auth.uid()) and merged_into_fan_id is null;
  if v_owner is null or not private.can_access_artist(v_artist) then raise exception 'Fan profile not found'; end if;
  if p_channel is not null and p_channel not in ('instagram','youtube','tiktok','email','sms') then
    raise exception 'Unsupported permission channel';
  end if;

  update public.fan_permissions p
  set status = 'revoked', source = 'privacy_request', evidence_at = now()
  from public.fan_identities i
  where p.identity_id = i.id
    and i.fan_id = p_fan_id
    and (p_channel is null or p.channel = p_channel)
    and p.status <> 'revoked';
  get diagnostics v_count = row_count;

  insert into public.fan_privacy_events(owner_id, artist_id, fan_id, request_type, channel, result_summary)
  values(v_owner, v_artist, p_fan_id, 'revoke', p_channel, jsonb_build_object('permissionCount', v_count));
  return v_count;
end;
$$;

create or replace function public.delete_fan_personal_data(p_fan_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_artist uuid;
  v_interaction_ids uuid[];
  v_alias_ids uuid[];
begin
  select owner_id, artist_id into v_owner, v_artist
  from public.fan_profiles
  where id = p_fan_id and owner_id = (select auth.uid()) and merged_into_fan_id is null;
  if v_owner is null or not private.can_access_artist(v_artist) then raise exception 'Fan profile not found'; end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_alias_ids
  from public.fan_profiles where merged_into_fan_id = p_fan_id and owner_id = v_owner and artist_id = v_artist;

  select coalesce(array_agg(l.interaction_id), '{}'::uuid[]) into v_interaction_ids
  from public.fan_interaction_links l
  join public.fan_identities i on i.id = l.identity_id
  where i.fan_id = p_fan_id;

  insert into public.fan_privacy_events(owner_id, artist_id, fan_id, request_type, result_summary)
  values(
    v_owner, v_artist, p_fan_id, 'delete',
    jsonb_build_object(
      'redactedInteractions', coalesce(array_length(v_interaction_ids, 1), 0),
      'removedMergedAliases', coalesce(array_length(v_alias_ids, 1), 0)
    )
  );

  update public.audience_interactions
  set author_name = null,
      author_handle = null,
      body = '[deleted at fan privacy request]',
      raw = '{}'::jsonb,
      suggested_reply = null,
      reply_confidence = null,
      auto_reply_eligible = false
  where id = any(v_interaction_ids) and owner_id = v_owner and artist_id = v_artist;

  update public.fan_merge_events
  set status = 'privacy_deleted'
  where owner_id = v_owner and artist_id = v_artist and status = 'active'
    and (source_fan_id = p_fan_id or target_fan_id = p_fan_id
      or source_fan_id = any(v_alias_ids) or target_fan_id = any(v_alias_ids));

  delete from public.fan_profiles
  where owner_id = v_owner and artist_id = v_artist and merged_into_fan_id = p_fan_id;
  delete from public.fan_profiles
  where id = p_fan_id and owner_id = v_owner and artist_id = v_artist;
end;
$$;

revoke all on function public.merge_fan_profiles(uuid,uuid,text,text) from public, anon;
revoke all on function public.revert_fan_merge(uuid) from public, anon;
revoke all on function public.record_fan_export(uuid) from public, anon;
revoke all on function public.revoke_fan_permissions(uuid,text) from public, anon;
revoke all on function public.delete_fan_personal_data(uuid) from public, anon;
grant execute on function public.merge_fan_profiles(uuid,uuid,text,text) to authenticated;
grant execute on function public.revert_fan_merge(uuid) to authenticated;
grant execute on function public.record_fan_export(uuid) to authenticated;
grant execute on function public.revoke_fan_permissions(uuid,text) to authenticated;
grant execute on function public.delete_fan_personal_data(uuid) to authenticated;

-- Artist-scoped read access. Fan profile/identity/permission edits require the active artist;
-- merge/privacy history is mutated only by the RPCs above.
do $$
declare
  t text;
begin
  foreach t in array array[
    'fan_profiles','fan_identities','fan_permissions','fan_interaction_links',
    'fan_merge_events','fan_privacy_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %1$I_select on public.%1$I for select to authenticated using (owner_id=auth.uid() and private.can_access_artist(artist_id))',
      t
    );
  end loop;
end $$;

grant insert, update, delete on public.fan_profiles, public.fan_identities, public.fan_permissions to authenticated;

create policy fan_profiles_insert on public.fan_profiles for insert to authenticated
  with check (owner_id = auth.uid() and private.can_access_artist(artist_id));
create policy fan_profiles_update on public.fan_profiles for update to authenticated
  using (owner_id = auth.uid() and private.can_access_artist(artist_id))
  with check (owner_id = auth.uid() and private.can_access_artist(artist_id));
create policy fan_profiles_delete on public.fan_profiles for delete to authenticated
  using (owner_id = auth.uid() and private.can_access_artist(artist_id));
create policy fan_identities_insert on public.fan_identities for insert to authenticated
  with check (owner_id = auth.uid() and private.can_access_artist(artist_id));
create policy fan_identities_update on public.fan_identities for update to authenticated
  using (owner_id = auth.uid() and private.can_access_artist(artist_id))
  with check (owner_id = auth.uid() and private.can_access_artist(artist_id));
create policy fan_identities_delete on public.fan_identities for delete to authenticated
  using (owner_id = auth.uid() and private.can_access_artist(artist_id));
create policy fan_permissions_insert on public.fan_permissions for insert to authenticated
  with check (owner_id = auth.uid() and private.can_access_artist(artist_id));
create policy fan_permissions_update on public.fan_permissions for update to authenticated
  using (owner_id = auth.uid() and private.can_access_artist(artist_id))
  with check (owner_id = auth.uid() and private.can_access_artist(artist_id));
create policy fan_permissions_delete on public.fan_permissions for delete to authenticated
  using (owner_id = auth.uid() and private.can_access_artist(artist_id));

revoke all on public.fan_profiles, public.fan_identities, public.fan_permissions,
  public.fan_interaction_links, public.fan_merge_events, public.fan_privacy_events from service_role;
grant all on public.fan_profiles, public.fan_identities, public.fan_permissions, public.fan_interaction_links to service_role;
grant select, insert, update on public.fan_merge_events to service_role;
grant select, insert on public.fan_privacy_events to service_role;

comment on table public.fan_profiles is
  'Artist-scoped relationship memory only. No sensitive traits or probabilistic identity attributes.';
comment on table public.fan_identities is
  'Channel identity evidence. Same-platform observed handles may repeat; cross-channel fan merges require explicit or verified evidence.';
comment on table public.fan_permissions is
  'Purpose-specific communication permission attached to the exact channel identity so merges cannot broaden consent.';
comment on table public.fan_merge_events is
  'Reversible identity merge evidence. Behavioral similarity and fuzzy matching are not valid merge evidence.';
