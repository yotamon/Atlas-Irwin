alter table public.fan_permissions
  add column evidence_note text;

alter table public.fan_permissions
  add constraint fan_permissions_manual_grant_evidence_check
  check (
    status <> 'granted'
    or source <> 'artist_record'
    or (
      evidence_at is not null
      and evidence_note is not null
      and char_length(btrim(evidence_note)) between 3 and 1000
    )
  );

comment on column public.fan_permissions.evidence_note is
  'Human-readable consent evidence context. Required when an artist manually records a granted permission.';
