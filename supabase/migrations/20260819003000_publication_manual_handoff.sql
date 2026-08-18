alter table public.publication_jobs
  drop constraint if exists publication_jobs_status_check;

alter table public.publication_jobs
  add constraint publication_jobs_status_check
  check (status in ('draft','awaiting_approval','approved','scheduled','publishing','manual_ready','published','failed','cancelled'));
