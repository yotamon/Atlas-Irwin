import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFile(`${root}/${path}`, "utf8");

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

test("onboarding understands music before asking working preferences and does not force every artist into a release", async () => {
  const page = await read("app/studio/onboarding/page.tsx");
  assert.match(page, /Five decisions, after the music/);
  assert.match(page, /else if \(analysisPending\) current = "analysis";\n  else if \(!operatingContext\.profileConfigured\) current = "operating";/);
  assert.match(page, /releaseFirst = operatingContext\.profileConfigured && operatingContext\.profile\.primaryGoal === "release_music"/);
  assert.match(page, /releaseFirst && !mission/);
  assert.match(page, /next useful Mission/);
  assert.match(page, /get_gigs|GOAL_LABELS/);
});

test("scene intelligence refuses invented targets and reuses the Growth opportunity queue", async () => {
  const [migration, scene, actions, strategy] = await Promise.all([
    read("supabase/migrations/20260906150000_artist_operating_system.sql"),
    read("lib/artist-operating/scene-intelligence.ts"),
    read("app/studio/artist-operating-actions.ts"),
    read("lib/artist-operating/strategy.ts"),
  ]);
  assert.match(migration, /artist_scene_relationships/);
  assert.match(migration, /verified_scene_relationship_requires_evidence/);
  assert.match(migration, /scene_fit.*outreach_target.*gig_fit.*label_fit.*playlist_fit.*channel_fit/s);
  assert.match(scene, /hasUsableSceneEvidence/);
  assert.match(scene, /confidence < 0\.35/);
  assert.match(actions, /growth_opportunities/);
  assert.match(actions, /sceneRelationshipOpportunityKind/);
  assert.match(actions, /does not yet have enough evidence to name labels, playlists, channels, promoters or festivals/);
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
  assert.match(today, /I just want to make music|MARKETING_INVOLVEMENT_LABELS/);
  assert.match(today, /Keep making music/);
  assert.match(create, /Real artist material comes first/);
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
  assert.match(today, /View manager plan/);
  assert.match(today, /Keep making music\. Ensemblis is managing the next moves\./);
});
