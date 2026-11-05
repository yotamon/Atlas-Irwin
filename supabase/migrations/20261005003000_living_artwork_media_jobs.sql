-- Ensemblis #285: extend the existing durable marketing media queue for Living Artwork.
-- Keep one queue/recovery model; do not introduce a parallel workflow table.

do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.marketing_media_jobs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%job_type%'
  loop
    execute format('alter table public.marketing_media_jobs drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.marketing_media_jobs
  add constraint marketing_media_jobs_job_type_check
  check (job_type in ('finish_social_video','normalize_loop_video','render_loop_visualizer'));

create index if not exists marketing_media_jobs_artist_type_status_idx
  on public.marketing_media_jobs(artist_id, job_type, status, created_at);
