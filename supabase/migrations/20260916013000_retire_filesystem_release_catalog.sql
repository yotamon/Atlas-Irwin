-- Filesystem release manifests are archived URL compatibility only.
-- Supabase catalog and media tables are the sole runtime source of truth.

alter table public.releases
  drop column if exists public_release_path;
