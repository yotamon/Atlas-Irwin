begin;

select plan(14);

insert into auth.users (id,email,aud,role,created_at,updated_at)
values ('19000000-0000-0000-0000-000000000001','moment-calibration@example.com','authenticated','authenticated',now(),now());

update public.profiles set is_admin = true
where id = '19000000-0000-0000-0000-000000000001';

delete from public.workspaces
where legacy_owner_id = '19000000-0000-0000-0000-000000000001';

insert into public.workspaces(id,name,slug,kind,created_by,legacy_owner_id)
values ('29000000-0000-0000-0000-000000000001','Calibration Workspace','calibration-workspace','personal','19000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001');
insert into public.workspace_memberships(workspace_id,profile_id,role,status)
values ('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','owner','active');
insert into public.artists(id,workspace_id,name,slug,legacy_owner_id)
values ('39000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','Calibration Artist','calibration-artist','19000000-0000-0000-0000-000000000001');

insert into public.releases(id,owner_id,artist_id,title,slug)
values ('49000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','Calibration Release','calibration-release');
insert into public.tracks(id,release_id,owner_id,title,duration,audio_url)
values ('59000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','Calibration Track',180,'https://example.com/calibration-v1.wav');

insert into public.track_music_intelligence(
  track_id,owner_id,analysis_version,engine,quality,semantic_structure,
  source_audio_url,audio_sha256,analysis
) values (
  '59000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001',4,'test','full',true,
  'https://example.com/calibration-v1.wav','calibration-sha-v1',
  '{"source":"worker","version":4,"hook_candidates":[{"id":"hook-cal-a","start_ms":10000,"end_ms":18000,"kind":"instant_hook","label":"Hook A","score":0.82,"metrics":{"energy":0.72},"intent_scores":{"instant_hook":0.88}},{"id":"hook-cal-b","start_ms":40000,"end_ms":56000,"kind":"groove_loop","label":"Hook B","score":0.80,"metrics":{"energy":0.70},"intent_scores":{"instant_hook":0.75}}]}'::jsonb
);

select ok(
  count(*) = 2,
  'Track Intelligence materializes two calibration candidates'
)
from public.moments
where track_id = '59000000-0000-0000-0000-000000000001'::uuid
  and state = 'proposed';

-- Give generated test Moments deterministic IDs before any calibration events reference them.
update public.moments
set id = '69000000-0000-0000-0000-000000000001'::uuid
where track_id = '59000000-0000-0000-0000-000000000001'::uuid
  and source_candidate_id = 'hook-cal-a';
update public.moments
set id = '69000000-0000-0000-0000-000000000002'::uuid
where track_id = '59000000-0000-0000-0000-000000000001'::uuid
  and source_candidate_id = 'hook-cal-b';

select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select isnt(
  public.review_moment_with_calibration(
    '69000000-0000-0000-0000-000000000001'::uuid,
    '49000000-0000-0000-0000-000000000001'::uuid,
    'approve',11000,20000,'Artist favorite hook',
    'best'::public.moment_calibration_judgment,null,15,null,'{"source":"pgtap"}'::jsonb
  ),
  null::uuid,
  'artist can approve a Moment and append calibration atomically'
);
reset role;

select ok(
  count(*) = 1,
  'artist timing changes effective window without rewriting immutable source timing'
)
from public.moments
where id = '69000000-0000-0000-0000-000000000001'::uuid
  and state = 'approved'
  and start_ms = 11000
  and end_ms = 20000
  and source_start_ms = 10000
  and source_end_ms = 18000;

select ok(
  count(*) = 1,
  'calibration snapshots exact Moment, analyzer and master provenance'
)
from public.moment_calibration_events e
join public.moments m on m.id = e.moment_id
where e.moment_id = '69000000-0000-0000-0000-000000000001'::uuid
  and e.moment_source_fingerprint = m.source_fingerprint
  and e.moment_track_analysis_version is not distinct from m.track_analysis_version
  and e.moment_track_analysis_audio_sha256 is not distinct from m.track_analysis_audio_sha256
  and e.source_start_ms = m.source_start_ms
  and e.source_end_ms = m.source_end_ms
  and e.preferred_cut_seconds = 15;

select ok(
  round(private.moment_calibration_delta('69000000-0000-0000-0000-000000000001'::uuid),2) = 0.18::numeric,
  'Best Moment judgment contributes the bounded direct preference boost'
);

select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select isnt(
  public.review_moment_with_calibration(
    '69000000-0000-0000-0000-000000000002'::uuid,
    '49000000-0000-0000-0000-000000000001'::uuid,
    'approve',40000,56000,'Useful but second choice',
    'useful'::public.moment_calibration_judgment,'groove support',30,
    '69000000-0000-0000-0000-000000000001'::uuid,
    '{"source":"pgtap"}'::jsonb
  ),
  null::uuid,
  'artist can explicitly prefer another active Moment from the same track'
);
reset role;

select ok(
  round(private.moment_calibration_delta('69000000-0000-0000-0000-000000000002'::uuid),2) = 0.02::numeric,
  'Useful source Moment is reduced when the artist explicitly prefers another Moment'
);

select ok(
  round(private.moment_calibration_delta('69000000-0000-0000-0000-000000000001'::uuid),2) = 0.20::numeric,
  'incoming preference plus favorite judgment is capped at the calibration ceiling'
);

select ok(
  not has_table_privilege('authenticated','public.moment_calibration_events','INSERT')
  and not has_table_privilege('authenticated','public.moment_calibration_events','UPDATE')
  and not has_table_privilege('authenticated','public.moment_calibration_events','DELETE'),
  'authenticated clients cannot bypass the review RPC to mutate calibration history'
);

update public.tracks
set audio_url = 'https://example.com/calibration-v2.wav'
where id = '59000000-0000-0000-0000-000000000001'::uuid;

select ok(
  count(*) = 0,
  'master replacement supersedes calibrated old-Master Moments'
)
from public.moments
where track_id = '59000000-0000-0000-0000-000000000001'::uuid
  and state in ('proposed','approved');

-- Master replacement intentionally invalidates and deletes canonical Track Intelligence.
-- A real re-analysis therefore inserts/upserts a fresh canonical row rather than updating the stale row.
insert into public.track_music_intelligence(
  track_id,owner_id,analysis_version,engine,quality,semantic_structure,
  source_audio_url,audio_sha256,analysis
) values (
  '59000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001',5,'test','full',true,
  'https://example.com/calibration-v2.wav','calibration-sha-v2',
  '{"source":"worker","version":5,"hook_candidates":[{"id":"hook-cal-v2","start_ms":12000,"end_ms":30000,"kind":"instant_hook","label":"Fresh Hook","score":0.9,"metrics":{"energy":0.8},"intent_scores":{"instant_hook":0.92}}]}'::jsonb
);

select ok(
  count(*) = 1,
  'fresh Track Intelligence can materialize after a master replacement'
)
from public.track_music_intelligence
where track_id = '59000000-0000-0000-0000-000000000001'::uuid
  and analysis_version = 5
  and source_audio_url = 'https://example.com/calibration-v2.wav';

select ok(
  count(*) = 1,
  'new master creates a fresh active Moment rather than reviving old lineage'
)
from public.moments
where track_id = '59000000-0000-0000-0000-000000000001'::uuid
  and state = 'proposed'
  and source_candidate_id = 'hook-cal-v2';

select ok(
  count(*) = 1
  and coalesce(bool_and(round(private.moment_calibration_delta(id),2) = 0.00::numeric), false),
  'old-master calibration contributes nothing to the fresh Moment'
)
from public.moments
where track_id = '59000000-0000-0000-0000-000000000001'::uuid
  and source_candidate_id = 'hook-cal-v2';

select ok(
  count(*) = 2,
  'calibration history remains durable after the canonical master changes'
)
from public.moment_calibration_events
where owner_id = '19000000-0000-0000-0000-000000000001'::uuid;

select * from finish();
rollback;