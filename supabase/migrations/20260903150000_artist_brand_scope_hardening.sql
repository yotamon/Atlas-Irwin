-- Ensemblis #71: brand identity is artist-local, not owner-local.
-- Remove legacy owner/section uniqueness and replace it with artist/section uniqueness.

do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.brand_settings'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%owner_id%'
      and pg_get_constraintdef(oid) ilike '%section%'
  loop
    execute format('alter table public.brand_settings drop constraint %I', r.conname);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'brand_settings'
      and indexdef ilike '%unique%'
      and indexdef ilike '%owner_id%'
      and indexdef ilike '%section%'
  loop
    execute format('drop index if exists public.%I', r.indexname);
  end loop;
end $$;

create unique index if not exists brand_settings_artist_section_idx
  on public.brand_settings(artist_id, section);
