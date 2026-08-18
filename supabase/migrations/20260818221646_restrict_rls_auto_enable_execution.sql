-- rls_auto_enable is an internal event-trigger function and should never be callable through the public API.
-- Some fresh/local Supabase instances do not define this platform helper, so harden it only when present.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
      and p.pronargs = 0
  ) then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
