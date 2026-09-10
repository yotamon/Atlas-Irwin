import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = process.cwd();
const read = async (path) => (await readFile(`${root}/${path}`, "utf8")).replace(/\r\n/g, "\n");

test("artist operating profile keeps AI optional and human projects conservative", async () => {
  const [migration, aiMigration, domain, settings] = await Promise.all([
    read("supabase/migrations/20260906150000_artist_operating_system.sql"),
    read("supabase/migrations/20260906150500_artist_operating_ai_music_policy.sql"),
    read("lib/artist-operating/domain.ts"),
    read("app/studio/(protected)/settings/artist/page.tsx"),
  ]);
  assert.match(migration, /artist_operating_profiles/);
  assert.match(migration, /just_make_music/);
  assert.match(migration, /ai_visuals_allowed boolean not null default false/);
  assert.match(aiMigration, /ai_music_allowed boolean not null default false/);
  assert.match(domain, /projectType === "ai_assisted" \|\| projectType === "hybrid" \|\| projectType === "virtual_persona"/);
  assert.match(domain, /musicAllowed: aiNativeCapability/);
  assert.match(domain, /voiceAllowed: false/);
  assert.match(domain, /likenessAllowed: false/);
  assert.ok(domain.indexOf('"Real artist media"') < domain.indexOf('"Generative visuals when they strengthen the concept"'));
  assert.match(settings, /AI is a capability, not the artist identity/);
  assert.match(settings, /AI music creation/);
});

test("onboarding understands music before asking only irreducible working preferences and does not force every artist into a release", async () => {
  const [page, forms] = await Promise.all([
    read("app/studio/onboarding/page.tsx"),
    read("components/studio/onboarding-forms.tsx"),
  ]);
  assert.match(page, /Only what the music cannot tell us/);
  assert.match(page, /The music is already understood\. These few preferences decide how much Ensemblis should handle/);
  assert.match(page, /else if \(analysisPending\) current = "analysis";\n  else if \(!operatingContext\.profileConfigured\) current = "operating";/);
  assert.match(page, /releaseFirst = operatingContext\.profileConfigured && operatingContext\.profile\.primaryGoal === "release_music"/);
  assert.match(page, /releaseFirst && !mission/);
  assert.match(page, /next useful Mission/);
  assert.match(forms, /get_gigs|GOAL_LABELS/);
  assert.doesNotMatch(page, /Five decisions, after the music/);
});

test("scene intelligence refuses invented targets and reuses the Growth opportunity queue", async () => {
  const [migration, scene, materializer, strategy] = await Promise.all([
    read("supabase/migrations/20260906150000_artist_operating_system.sql"),
    read("lib/artist-operating/scene-intelligence.ts"),
    read("lib/artist-operating/growth-opportunities.ts"),
    read("lib/artist-operating/strategy.ts"),
  ]);
  assert.match(migration, /artist_scene_relationships/);
  assert.match(migration, /verified_scene_relationship_requires_evidence/);
  assert.match(migration, /scene_fit.*outreach_target.*gig_fit.*label_fit.*playlist_fit.*channel_fit/s);
  assert.match(scene, /hasUsableSceneEvidence/);
  assert.match(scene, /confidence < 0\.35/);
  assert.match(materializer, /growth_opportunities/);
  assert.match(materializer, /sceneRelationshipOpportunityKind/);
  assert.match(materializer, /does not yet have enough evidence to name labels, playlists, channels, promoters or festivals/);
  assert.match(strategy, /Do not manufacture scene credibility, named targets or audience facts without evidence/);
});

test("Today stays a thin Manager renderer while the snapshot owns artist operating context", async () => {
  const [today, snapshot, create, createActions, server] = await Promise.all([
    read("app/studio/(protected)/page.tsx"),
    read("lib/studio/artist-operating-snapshot.ts"),
    read("app/studio/(protected)/create/page.tsx"),
    read("app/studio/create-actions.ts"),
    read("lib/artist-operating/server.ts"),
  ]);
  assert.match(today, /loadArtistOperatingSnapshot/);
  assert.doesNotMatch(today, /loadArtistOperatingContext/);
  assert.match(snapshot, /loadArtistOperatingContext/);
  assert.match(snapshot, /const strategy = buildArtistStrategy\(operatingContext\)/);
  assert.match(today, /marketingInvolvement === "just_make_music"/);
  assert.match(today, /Keep making music/);
  assert.match(today, /Ensemblis is handling/);
  assert.doesNotMatch(today, /MARKETING_INVOLVEMENT_LABELS|Artist operating mode/);
  assert.match(create, /creativeSourceHierarchy\(operatingContext\.profile\)/);
  assert.match(create, /Artist creative policy/);
  assert.match(create, /AI music creation is disabled for this artist/);
  assert.match(createActions, /artistCreativePolicyBrief/);
  assert.match(server, /profileConfigured/);
  assert.match(server, /strategySnapshot/);
});

test("Manager planning reaches quiet artists and follows the configured working relationship", async () => {
  const [nextBest, snapshot, today] = await Promise.all([
    read("lib/marketing/next-best-action.ts"),
    read("lib/studio/artist-operating-snapshot.ts"),
    read("app/studio/(protected)/page.tsx"),
  ]);
  assert.match(nextBest, /from\("artists"\).*eq\("status", "active"\)/s);
  assert.match(nextBest, /artist_operating_profiles/);
  assert.match(nextBest, /primary_goal/);
  assert.match(nextBest, /managerOwned/);
  assert.match(nextBest, /advance_gig_strategy/);
  assert.match(nextBest, /advance_label_strategy/);
  assert.match(nextBest, /advance_owned_audience/);
  assert.match(nextBest, /operatingSchemaMissing/);
  assert.match(nextBest, /existingManager/);
  assert.match(nextBest, /"approved", "executing", "completed", "dismissed"/);
  assert.match(snapshot, /humanNextAction/);
  assert.match(snapshot, /managerPlan/);
  assert.match(today, /const handsOff = operatingContext\.profile\.marketingInvolvement === "just_make_music"/);
  assert.match(today, /See what Ensemblis is handling/);
  assert.match(today, /#ensemblis-handling/);
  assert.doesNotMatch(today, /View manager plan/);
  assert.match(today, /Keep making music\. Ensemblis is managing the next moves\./);
});

test("hands-off Manager executes only safe internal evidence-backed preparation", async () => {
  const [executor, materializer, actions, cron, snapshot] = await Promise.all([
    read("lib/marketing/manager-execution.ts"),
    read("lib/artist-operating/growth-opportunities.ts"),
    read("app/studio/artist-operating-actions.ts"),
    read("app/api/cron/marketing/route.ts"),
    read("lib/studio/artist-operating-snapshot.ts"),
  ]);

  assert.match(executor, /SAFE_MANAGER_ACTIONS/);
  assert.match(executor, /advance_gig_strategy/);
  assert.match(executor, /advance_label_strategy/);
  assert.match(executor, /payload\.managerOwned !== true/);
  assert.match(executor, /liveTargetCount|labelTargetCount/);
  assert.match(executor, /relationship\.fitScore >= 60/);
  assert.match(executor, /relationship\.confidence >= 0\.35/);
  assert.match(executor, /status: "executing"/);
  assert.match(executor, /retryAfter/);
  assert.doesNotMatch(executor, /processDuePublicationJobs|processDueOutreachEnrollments|processAutonomousCreativeSpend/);

  assert.match(materializer, /TERMINAL_GROWTH_STATUSES/);
  assert.match(materializer, /accepted.*dismissed.*completed/);
  assert.match(materializer, /actionablePrepared/);
  assert.match(materializer, /includeSceneMapFallback = true/);
  assert.match(materializer, /usedSceneMapFallback/);
  assert.match(actions, /materializeSceneGrowthOpportunities/);

  assert.match(cron, /executeSafeManagerActions/);
  assert.match(cron, /deterministic \$0 internal preparation/);
  assert.match(snapshot, /status: "Prepared"/);
  assert.match(snapshot, /completedManagerActions/);
  assert.match(snapshot, /execution\.prepared/);
});

test("Manager reuses deterministic Growth engines for release, discovery and fan growth", async () => {
  const [executor, preparation] = await Promise.all([
    read("lib/marketing/manager-execution.ts"),
    read("lib/studio/growth-preparation.ts"),
  ]);

  assert.match(executor, /advance_discovery/);
  assert.match(executor, /advance_fan_growth/);
  assert.match(executor, /advance_release_strategy/);
  assert.match(executor, /playlist.*channel/s);
  assert.match(executor, /catalog_revival.*content_breakout/s);
  assert.match(executor, /funnel_bottleneck/);
  assert.match(executor, /release_risk.*release_candidate/s);
  assert.match(executor, /prepareDetectedGrowthOpportunities/);
  assert.match(executor, /prepareReleaseGrowthPlan/);
  assert.match(executor, /advance_owned_audience/);
  assert.match(executor, /finalStatus = result\.prepared > 0 \? "completed" as const : "dismissed" as const/);
  assert.match(executor, /systemNoOp: result\.prepared === 0/);

  assert.match(preparation, /planReleaseQueue/);
  assert.match(preparation, /detectGrowthOpportunities/);
  assert.match(preparation, /PRESERVED_OPPORTUNITY_STATUSES/);
  assert.match(preparation, /accepted.*dismissed.*completed/);
  assert.match(preparation, /committedTrackIds/);
  assert.match(preparation, /autoplan_disabled/);
  assert.match(preparation, /catalog_engine_disabled/);
  assert.match(preparation, /status: "proposed" as const/);
  assert.match(preparation, /status = preserveLifecycle \? previous!\.status : "new"/);
});

test("owned-audience Manager preparation is consent-first and reuses the Fan Quality permission contract", async () => {
  const [executor, preparation, quality, migration, growthTypes] = await Promise.all([
    read("lib/marketing/manager-execution.ts"),
    read("lib/audience/owned-audience-preparation.ts"),
    read("lib/audience/fan-quality.ts"),
    read("supabase/migrations/20260906165000_owned_audience_growth_opportunity.sql"),
    read("types/growth-database.ts"),
  ]);

  assert.match(executor, /advance_owned_audience/);
  assert.match(executor, /prepareOwnedAudienceOpportunity/);
  assert.match(executor, /source: "owned_audience"/);
  assert.match(preparation, /permissionedOwnedFanIds/);
  assert.match(quality, /verified_email/);
  assert.match(quality, /verified_phone/);
  assert.match(quality, /email_marketing/);
  assert.match(quality, /sms_marketing/);
  assert.match(quality, /permission\.evidence_at/);
  assert.match(quality, /permission\.expires_at/);
  assert.match(preparation, /relationshipGap/);
  assert.match(preparation, /smart_link_readback/);
  assert.match(preparation, /externalContactRequiresApproval: true/);
  assert.match(preparation, /Never infer a new purpose, channel or identity/);
  assert.doesNotMatch(preparation, /fetch\(|processDuePublicationJobs|outreach_messages|MailerLite|MAILERLITE/);
  assert.match(preparation, /owned_audience_lifecycle_preserved/);
  assert.match(preparation, /owned_audience_already_prepared/);
  assert.match(migration, /owned_audience/);
  assert.match(growthTypes, /\| "owned_audience"/);
});
