begin;

select plan(8);

insert into auth.users (id,email,aud,role,created_at,updated_at)
values ('18000000-0000-0000-0000-000000000001','creative-lineage@example.com','authenticated','authenticated',now(),now());
update public.profiles set is_admin=true where id='18000000-0000-0000-0000-000000000001';
delete from public.workspaces where legacy_owner_id='18000000-0000-0000-0000-000000000001';
insert into public.workspaces(id,name,slug,kind,created_by,legacy_owner_id)
values ('28000000-0000-0000-0000-000000000001','Creative Workspace','creative-workspace','personal','18000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001');
insert into public.workspace_memberships(workspace_id,profile_id,role,status)
values ('28000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001','owner','active');
insert into public.artists(id,workspace_id,name,slug,legacy_owner_id)
values ('38000000-0000-0000-0000-000000000001','28000000-0000-0000-0000-000000000001','Creative Artist','creative-artist','18000000-0000-0000-0000-000000000001');
insert into public.releases(id,owner_id,artist_id,title,slug)
values ('48000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001','38000000-0000-0000-0000-000000000001','Creative Release','creative-release');
insert into public.tracks(id,release_id,owner_id,title,duration,audio_url)
values ('58000000-0000-0000-0000-000000000001','48000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001','Creative Track',120,'https://example.com/creative.wav');
insert into public.moments(
  id,owner_id,artist_id,release_id,track_id,start_ms,end_ms,source_start_ms,source_end_ms,
  moment_type,label,source_mode,source_fingerprint,purpose_tags,hook_score,vocal_score,confidence,state
) values (
  '68000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001','38000000-0000-0000-0000-000000000001',
  '48000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000001',12000,20000,12000,20000,
  'hook','Creative Moment','audio','creative-moment',array['short_form_hook'],0.9,0.8,0.9,'approved'
);
insert into public.campaigns(id,owner_id,artist_id,release_id,name)
values ('78000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001','38000000-0000-0000-0000-000000000001','48000000-0000-0000-0000-000000000001','Creative Campaign');

insert into public.content_items(
  id,owner_id,artist_id,release_id,campaign_id,title,platform,format,goal,source,
  content_angle,audience_segment,hook_text,caption,cta,visual_prompt,production_notes
) values (
  '88000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001','38000000-0000-0000-0000-000000000001',
  '48000000-0000-0000-0000-000000000001','78000000-0000-0000-0000-000000000001','Recipe content','Instagram','Reel','Saves','planner',
  'vocal cold open','listeners','Start on the voice','Original caption','Save it','tactile closeup','cold open, then payoff'
);

select ok(
  (select moment_id='68000000-0000-0000-0000-000000000001'::uuid and creative_recipe_id is not null
   from public.content_items where id='88000000-0000-0000-0000-000000000001'),
  'generated content carries both an approved Moment and an immutable creative recipe reference'
);
select is(
  (select recipe ->> 'contentAngle' from public.creative_recipes where id=(select creative_recipe_id from public.content_items where id='88000000-0000-0000-0000-000000000001')),
  'vocal cold open',
  'the content recipe captures the creative treatment that caused the execution'
);

create temporary table original_recipe as
select creative_recipe_id as id from public.content_items where id='88000000-0000-0000-0000-000000000001';
update public.content_items
set caption='Edited caption'
where id='88000000-0000-0000-0000-000000000001';
select isnt(
  (select creative_recipe_id from public.content_items where id='88000000-0000-0000-0000-000000000001'),
  (select id from original_recipe),
  'editing a generated treatment creates a new recipe revision instead of rewriting history'
);
select is(
  (select parent_recipe_id from public.creative_recipes where id=(select creative_recipe_id from public.content_items where id='88000000-0000-0000-0000-000000000001')),
  (select id from original_recipe),
  'recipe revisions retain explicit immutable parent lineage'
);

insert into public.content_variants(
  id,owner_id,artist_id,content_item_id,label,hypothesis,hook_text,caption,cta,visual_prompt,production_notes,is_control
) values (
  '89000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001','38000000-0000-0000-0000-000000000001',
  '88000000-0000-0000-0000-000000000001','B','A vocal cold-open improves save intent','Voice first','Variant caption','Save this','portrait crop','0.5s vocal open',false
);
select ok(
  (select creative_recipe_id is not null from public.content_variants where id='89000000-0000-0000-0000-000000000001'),
  'each creative variant gets its own causal recipe snapshot'
);

insert into public.publication_jobs(
  id,owner_id,artist_id,campaign_id,content_item_id,content_variant_id,platform,adapter,status,approval_status,request_payload
) values (
  '8a000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001','38000000-0000-0000-0000-000000000001',
  '78000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-000000000001','89000000-0000-0000-0000-000000000001',
  'Instagram','manual:instagram','approved','approved','{}'
);
select ok(
  (select moment_id='68000000-0000-0000-0000-000000000001'::uuid
          and creative_recipe_id=(select creative_recipe_id from public.content_variants where id='89000000-0000-0000-0000-000000000001')
   from public.publication_jobs where id='8a000000-0000-0000-0000-000000000001'),
  'publication snapshots the exact musical and creative lineage before external execution'
);

insert into public.metric_snapshots(
  owner_id,artist_id,date,platform,release_id,content_item_id,content_variant_id,views,saves,source,external_object_id,captured_at
) values (
  '18000000-0000-0000-0000-000000000001','38000000-0000-0000-0000-000000000001',current_date,'Instagram','48000000-0000-0000-0000-000000000001',
  '88000000-0000-0000-0000-000000000001','89000000-0000-0000-0000-000000000001',1000,80,'instagram_api','ig-creative-lineage',now()
);
select ok(
  (select creative_recipe_id is not null and creative_recipe ->> 'hookText'='Voice first'
   from public.verified_creative_learning_evidence where content_variant_id='89000000-0000-0000-0000-000000000001'),
  'trusted provider outcomes resolve back to the immutable variant treatment that produced them'
);
select is(
  (select count(*)::integer from public.creative_recipes where artist_id='38000000-0000-0000-0000-000000000001'),
  3,
  'creative history contains the original content recipe, its edit revision, and the variant recipe'
);

select * from finish();
rollback;
