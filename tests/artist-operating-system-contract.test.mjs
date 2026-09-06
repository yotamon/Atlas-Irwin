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
  assert.match(snapshot, /strategy: buildArtistStrategy\(operatingContext\)/);
  assert.match(today, /I just want to make music|MARKETING_INVOLVEMENT_LABELS/);
  assert.match(today, /Keep making music/);
  assert.match(create, /Real artist material comes first/);
  assert.match(create, /AI music creation is disabled for this artist/);
  assert.match(createActions, /artistCreativePolicyBrief/);
  assert.match(server, /profileConfigured/);
  assert.match(server, /strategySnapshot/);
});

test("artist AI capability policy is enforced at server and provider boundaries, not only in UI", async () => {
  const [guard, guardMigration, musicPage, musicRoute, marketingActions, videoPipeline] = await Promise.all([
    read("lib/artist-operating/capability-guard.ts"),
    read("supabase/migrations/20260906151000_artist_ai_capability_guards.sql"),
    read("app/studio/(protected)/music/page.tsx"),
    read("app/api/studio/music/generate/route.ts"),
    read("app/studio/marketing-creative-actions.ts"),
    read("app/studio/video-pipeline-actions.ts"),
  ]);

  for (const capability of ["writing", "visuals", "music", "voice", "likeness"]) {
    assert.match(guard, new RegExp(`\\"${capability}\\"`));
    assert.match(guardMigration, new RegExp(`'${capability}'`));
  }

  assert.match(musicPage, /aiMusicAllowed/);
  assert.match(musicPage, /AI music is off for this artist/);
  assert.match(musicPage, /view === "generate" && !aiMusicAllowed/);
  assert.match(musicRoute, /resolveActiveArtistContext/);
  assert.match(musicRoute, /assertArtistAiCapability\(\{ artistId: artist\.artistId, capability: "music" \}\)/);
  assert.match(musicRoute, /ArtistAiCapabilityDisabledError/);
  assert.match(musicRoute, /status: 403/);

  const firstVisualGuard = marketingActions.indexOf('assertArtistAiCapability({ artistId: artist.artistId, capability: "visuals" })');
  const providerSubmit = marketingActions.indexOf("provider.submit(request");
  assert.ok(firstVisualGuard >= 0 && firstVisualGuard < providerSubmit, "marketing must enforce artist visual policy before provider submission");
  assert.ok(marketingActions.match(/assertArtistAiCapability\(\{ artistId: artist\.artistId, capability: "visuals" \}\)/g)?.length >= 2, "marketing must re-check visual policy at preparation and spend approval");

  assert.match(guardMigration, /before insert on public\.generation_runs/);
  assert.match(guardMigration, /new\.task_type is not null/);
  assert.match(guardMigration, /new\.purpose like 'content_asset:%'/);
  assert.match(guardMigration, /before insert or update of status, billing_status on public\.music_video_generations/);
  assert.match(guardMigration, /new\.status = 'approved'/);
  assert.match(guardMigration, /new\.billing_status = 'reserved'/);
  assert.match(guardMigration, /reserve_music_video_generation/);

  assert.match(videoPipeline, /resolveActiveArtistContext/);
  assert.match(videoPipeline, /loadVideoProjectContext\(db, projectId, user\.id, artist\.artistId\)/);
});
