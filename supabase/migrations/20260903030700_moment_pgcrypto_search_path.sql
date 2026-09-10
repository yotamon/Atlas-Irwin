-- Supabase installs pgcrypto in the trusted `extensions` schema. These two private functions
-- use digest() for deterministic source fingerprints, so expose only extensions + pg_catalog to
-- their lookup path. Never add public to SECURITY DEFINER function search paths.

alter function private.refresh_track_moments(uuid)
  set search_path = 'extensions', 'pg_catalog';

alter function private.validate_moment_fingerprint()
  set search_path = 'extensions', 'pg_catalog';
