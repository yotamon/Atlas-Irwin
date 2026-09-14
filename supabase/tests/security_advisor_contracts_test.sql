begin;

select plan(11);

select ok(
  not has_schema_privilege('anon', 'private', 'USAGE')
    and not has_schema_privilege('anon', 'private', 'CREATE'),
  'anon cannot access or create objects in the private schema'
);

select ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE')
    and not has_schema_privilege('authenticated', 'private', 'CREATE'),
  'authenticated cannot access or create objects in the private schema'
);

select ok(
  not has_schema_privilege('service_role', 'private', 'USAGE')
    and not has_schema_privilege('service_role', 'private', 'CREATE'),
  'service_role cannot bypass private-schema isolation directly'
);

select is(
  (
    select count(*)::bigint
    from information_schema.role_table_grants
    where table_schema = 'private'
      and table_name in ('social_channel_tokens', 'soundcloud_tokens', 'spotify_tokens')
      and grantee in ('anon', 'authenticated', 'service_role')
  ),
  0::bigint,
  'private provider-token tables expose no direct API-role table grants'
);

select ok(
  not has_table_privilege('anon', 'public.automation_runtime_secrets', 'SELECT'),
  'anon cannot read automation runtime secrets'
);

select ok(
  not has_table_privilege('authenticated', 'public.automation_runtime_secrets', 'SELECT'),
  'authenticated cannot read automation runtime secrets'
);

select ok(
  has_table_privilege('service_role', 'public.automation_runtime_secrets', 'SELECT'),
  'service_role retains the server-only automation secret read path'
);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and not (coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=true'])
  ),
  'all public views explicitly execute with security_invoker semantics'
);

select is(
  (
    select count(*)::bigint
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  2::bigint,
  'exactly two SECURITY DEFINER RPCs are intentionally anonymous'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and p.proname not in ('record_smart_link_event', 'resolve_artist_site_hostname')
  ),
  'anonymous SECURITY DEFINER exposure is limited to public Smart Link/site routing RPCs'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) config
        where config like 'search_path=%'
      )
  ),
  'every externally callable public SECURITY DEFINER function has an explicit search_path'
);

select * from finish();
rollback;
