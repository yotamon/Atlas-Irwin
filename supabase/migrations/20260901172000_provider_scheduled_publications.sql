alter table public.publication_jobs
  drop constraint if exists publication_jobs_status_check;

alter table public.publication_jobs
  add constraint publication_jobs_status_check
  check (status in (
    'draft',
    'awaiting_approval',
    'approved',
    'scheduled',
    'publishing',
    'provider_scheduled',
    'manual_ready',
    'published',
    'failed',
    'cancelled'
  ));

comment on column public.publication_jobs.status is
  'Publication lifecycle. provider_scheduled means the connected platform owns the future publish time and Atlas must reconcile provider state rather than re-upload.';
