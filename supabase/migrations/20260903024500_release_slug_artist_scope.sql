-- Ensemblis #70: release URLs are an artist-local identity, not an account-local identity.
--
-- The legacy Atlas schema prevented one profile from reusing the same release slug across
-- two artists because uniqueness was enforced on (owner_id, slug). Once the public catalog
-- is pinned to a specific Ensemblis artist, the correct invariant is (artist_id, slug).

alter table public.releases
  drop constraint if exists releases_owner_id_slug_key;

alter table public.releases
  add constraint releases_artist_id_slug_key unique (artist_id, slug);
