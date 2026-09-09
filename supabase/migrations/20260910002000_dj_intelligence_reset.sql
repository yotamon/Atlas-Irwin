-- Allow an authenticated Studio artist owner to reset all bounded DJ Intelligence evidence.
-- Reset is intentionally destructive only inside Personal DJ Intelligence and does not touch
-- tracks, mixes, releases, source libraries, or vendor data.

drop policy if exists "dj_profiles_delete_own" on public.dj_profiles;
create policy "dj_profiles_delete_own"
  on public.dj_profiles for delete to authenticated
  using (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

drop policy if exists "dj_preference_evidence_delete_own" on public.dj_preference_evidence;
create policy "dj_preference_evidence_delete_own"
  on public.dj_preference_evidence for delete to authenticated
  using (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

drop policy if exists "dj_library_history_evidence_delete_own" on public.dj_library_history_evidence;
create policy "dj_library_history_evidence_delete_own"
  on public.dj_library_history_evidence for delete to authenticated
  using (
    auth.uid() = owner_id
    and private.is_studio_admin()
    and private.can_access_artist(artist_id)
  );

grant delete on public.dj_profiles to authenticated;
grant delete on public.dj_preference_evidence to authenticated;
grant delete on public.dj_library_history_evidence to authenticated;

comment on policy "dj_library_history_evidence_delete_own" on public.dj_library_history_evidence is
  'Lets the artist fully forget imported DJ-library learning without deleting or mutating the source library.';
