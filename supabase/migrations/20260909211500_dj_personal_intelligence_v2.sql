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
    check (weight > 0 and weight <= 1);

-- v1 enforced one row per (job, evidence_type). v2 needs multiple inspectable decisions
-- from the same completed revision, keyed by evidence_key. Discover and drop the generated
-- v1 constraint by its columns so this remains safe even when PostgreSQL truncated its name.
do $$
declare
  legacy_constraint text;
begin
  select constraint_row.conname
    into legacy_constraint
    from (
      select
        c.conname,
        array_agg(a.attname::text order by key_column.ordinality) as column_names
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as key_column(attnum, ordinality)
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = key_column.attnum
      where c.conrelid = 'public.dj_preference_evidence'::regclass
        and c.contype = 'u'
      group by c.oid, c.conname
    ) constraint_row
    where constraint_row.column_names = array['owner_id','artist_id','automix_job_id','evidence_type']::text[]
    limit 1;

  if legacy_constraint is not null then
    execute format('alter table public.dj_preference_evidence drop constraint %I', legacy_constraint);
  end if;
end;
$$;

create unique index if not exists dj_preference_evidence_event_key
  on public.dj_preference_evidence(owner_id, artist_id, automix_job_id, evidence_type, evidence_key);

comment on column public.dj_preference_evidence.evidence_key is
  'Stable idempotency key for one inspectable evidence event inside an AutoMix/Set Builder job.';
comment on column public.dj_preference_evidence.weight is
  'Bounded evidence strength. It affects learned confidence and weighted aggregation, never hard planner safety.';
comment on table public.dj_preference_evidence is
  'Inspectable whole-plan feedback, explicit Set Builder edits, and approved-render evidence used for bounded Personal DJ Intelligence.';
