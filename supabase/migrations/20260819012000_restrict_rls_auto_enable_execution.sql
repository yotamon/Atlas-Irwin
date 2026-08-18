-- rls_auto_enable is an internal event-trigger function and should never be callable through the public API.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
