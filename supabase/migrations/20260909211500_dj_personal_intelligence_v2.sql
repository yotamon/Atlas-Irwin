-- Ensemblis Personal DJ Intelligence v2
-- Expand coarse whole-plan feedback into durable, weighted Set Builder decision evidence.

alter table public.dj_preference_evidence
  add column if not exists evidence_key text not null default 'primary',
  add column if not exists weight real not null default 1.0;

alter table public.dj_preference_evidence
  drop constraint if exists dj_preference_evidence_evidence_type_check;

alter table public.dj_preference_evidence
  add constraint dj_preference_evidence_evidence_type_check
    check (evidence_type in ('plan_feedback','plan_edit','plan_approval'));

alter table public.dj_preference_evidence
  drop constraint if exists dj_preference_evidence_weight_check;

alter table public.dj_preference_evidence
  add constraint dj_preference_evidence_weight_check
    check (weight between 0 and 1);

create unique index if not exists dj_preference_evidence_event_key
  on public.dj_preference_evidence(owner_id, artist_id, automix_job_id, evidence_type, evidence_key);

comment on column public.dj_preference_evidence.evidence_key is
  'Stable idempotency key for one inspectable evidence event inside an AutoMix/Set Builder job.';
comment on column public.dj_preference_evidence.weight is
  'Bounded evidence strength. It affects learned confidence and weighted aggregation, never hard planner safety.';
comment on table public.dj_preference_evidence is
  'Inspectable whole-plan feedback, explicit Set Builder edits, and approved-render evidence used for bounded Personal DJ Intelligence.';
