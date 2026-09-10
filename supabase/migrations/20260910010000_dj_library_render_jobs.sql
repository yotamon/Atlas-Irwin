-- Ensemblis DJ Library Bridge / Phase 8 local rendering
-- Rendering remains a device job. The cloud stores only a frozen MixPlan and path-free result metadata.

alter table public.dj_library_device_jobs
  drop constraint if exists dj_library_device_jobs_job_type_check;

alter table public.dj_library_device_jobs
  add constraint dj_library_device_jobs_job_type_check
  check (job_type in ('resolve_media', 'render_mixplan'));

alter table public.dj_library_device_jobs
  add column if not exists automix_job_id uuid references public.automix_jobs(id) on delete cascade;

create unique index if not exists dj_library_device_jobs_automix_job_idx
  on public.dj_library_device_jobs(automix_job_id)
  where automix_job_id is not null;

create index if not exists dj_library_device_jobs_render_queue_idx
  on public.dj_library_device_jobs(device_id, status, created_at)
  where job_type = 'render_mixplan';

comment on column public.dj_library_device_jobs.automix_job_id is
  'Optional AutoMix lineage owner for a path-free device-side frozen MixPlan render.';
