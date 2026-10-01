-- Mastering references Data API hardening.
-- Supabase stops auto-exposing new public tables to Data API roles on 2026-10-30.
-- Keep this table intentionally private from anon while preserving authenticated Studio
-- access and service-role worker callbacks.

revoke all on table public.mastering_references from anon;
grant select, insert, update, delete on table public.mastering_references to authenticated;
grant all on table public.mastering_references to service_role;

drop policy if exists "mastering_references_select_own" on public.mastering_references;
create policy "mastering_references_select_own"
  on public.mastering_references
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "mastering_references_insert_own" on public.mastering_references;
create policy "mastering_references_insert_own"
  on public.mastering_references
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "mastering_references_update_own" on public.mastering_references;
create policy "mastering_references_update_own"
  on public.mastering_references
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "mastering_references_delete_own" on public.mastering_references;
create policy "mastering_references_delete_own"
  on public.mastering_references
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

comment on table public.mastering_references is
  'Artist-approved mastering comparison evidence. Data API access is explicit: authenticated owner-scoped access plus service-role worker access; no anon access.';

