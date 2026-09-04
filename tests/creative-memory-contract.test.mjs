import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

async function requireSnippets(path, snippets) {
  const text = await read(path);
  for (const snippet of snippets) {
    assert.ok(text.includes(snippet), `${path} must retain Creative Memory contract: ${snippet}`);
  }
  return text;
}

test("Creative Memory persistence is explicitly artist-scoped and reversible", async () => {
  const migration = await read("supabase/migrations/20260905001500_creative_memory_v1.sql");
  assert.ok(migration.includes("create table if not exists public.creative_memory_events"));
  assert.ok(migration.includes("artist_id uuid not null references public.artists"));
  assert.ok(migration.includes("unique (owner_id, artist_id, idempotency_key)"));
  assert.ok(migration.includes("create table if not exists public.creative_asset_profiles"));
  assert.ok(migration.includes("visual_descriptors text[]"));
  assert.ok(migration.includes("semantic_descriptors text[]"));
  assert.ok(migration.includes("brand_relevance real"));
  assert.ok(migration.includes("excluded boolean"));
  assert.ok(migration.includes("duplicate_of_asset_id"));
  assert.ok(migration.includes("alter table public.creative_memory_events enable row level security"));
  assert.ok(migration.includes("grant select, insert on table public.creative_memory_events to authenticated"));
  assert.ok(!migration.includes("grant update on table public.creative_memory_events to authenticated"));
  assert.ok(!migration.includes("grant delete on table public.creative_memory_events to authenticated"));
});

test("Creative Memory ranking rewards evidence and penalizes rejection, duplicates and exclusions", async () => {
  const domain = await read("lib/creative-memory/domain.ts");
  const server = await read("lib/creative-memory/server.ts");
  await requireSnippets("lib/creative-memory/domain.ts", [
    "input.approvals * 18",
    "input.rejections * 28",
    "input.performanceScore",
    "input.brandRelevance",
    "input.sameRelease",
    "input.sameTrack",
    "input.sameMoment",
    "input.duplicate",
    "input.excluded",
  ]);
  await requireSnippets("lib/creative-memory/server.ts", [
    '.eq("artist_id", input.artistId)',
    'from("metric_snapshots")',
    "content_hash",
    "perceptual_hash",
    "duplicateOfAssetId",
    "reasons: uniqueStrings",
  ]);
  assert.ok(domain.includes("Explicitly excluded"));
  assert.ok(server.includes("exclusionReason"));
});

test("Video Director consumes artist Creative Memory instead of owner-global preferences", async () => {
  const context = await requireSnippets("lib/video-director/context.ts", [
    "loadArtistCreativeMemory",
    "expectedArtistId",
    '.eq("artist_id", artistId)',
    "creativeMemory.preferences.positive",
    "creativeMemory.preferences.negative",
    "recommendation_score",
    "recommendation.reasons",
  ]);
  assert.ok(!context.includes("music_video_director_preferences"));
  await requireSnippets("lib/video-director/creative-director.ts", [
    "artistId: string",
    "creativeMemory:",
    "CreativeMemoryRecommendation",
  ]);
});

test("Quick Video and shot reviews create durable artist-specific learning evidence", async () => {
  await requireSnippets("app/studio/video-actions.ts", [
    'eventType: "direction_selected"',
    "anchor_moment_id: selectedDirection.anchorMomentId",
    "artistId: artist.artistId",
    "videoProjectId: data.id",
  ]);
  await requireSnippets("lib/video-director/preferences.ts", [
    'eventType: "preference_signal"',
    'input.positive ? "shot_locked" : "shot_rejected"',
    "upsertCreativeAssetProfile",
    "release.artist_id",
    "brief.anchor_moment_id",
  ]);
  await requireSnippets("app/studio/video-look-actions.ts", [
    'eventType: "reference_rejected"',
    'eventType: "shot_replaced"',
    "resolveActiveArtistContext",
  ]);
  await requireSnippets("app/studio/creative-memory-video-actions.ts", [
    'eventType: "reference_approved"',
    "prepareShotGenerationRecords",
    "brandRelevance: 0.8",
  ]);
});

test("Library exposes explainable memory without deleting rejected source media", async () => {
  const page = await requireSnippets("app/studio/(protected)/library/page.tsx", [
    "loadArtistCreativeMemory",
    "Ensemblis would reuse these first",
    "reference.reasons[0]",
    "approved ·",
    "Stop recommending",
    "Restore",
    "creativeMemory.excluded",
  ]);
  assert.ok(!page.includes('from("media_assets").delete'));
  await requireSnippets("app/studio/creative-memory-actions.ts", [
    "resolveActiveArtistContext",
    "setCreativeAssetExcluded",
    "This asset does not belong to the active artist's Creative Memory.",
  ]);
});

test("Production surfaces strongest remembered references with reasons before paid generation", async () => {
  const panel = await requireSnippets("components/studio/video-director/look-development-panel.tsx", [
    "data.creativeMemory.recommendations.slice(0, 4)",
    "References Ensemblis would reuse first",
    "reference.reasons[0]",
    "context references, not new paid generations",
    "approveCreativeMemoryLookReferences",
    "approveAndGenerateLookDevelopment",
  ]);
  assert.ok(panel.indexOf("Creative Memory") < panel.indexOf("Approval envelope"));
  const generation = await read("lib/video-director/generation.ts");
  assert.ok(generation.includes("createApprovalEnvelope"));
  assert.ok(generation.includes("hard_budget_credits"));
  assert.ok(generation.includes("assertSpecialistMediaSpendAllowed"));
});

test("Video project deep links and Quick Video orchestration cannot cross active artists", async () => {
  await requireSnippets("app/studio/(protected)/video/[id]/page.tsx", [
    "resolveActiveArtistContext",
    "asArtistScopedMusicClient",
    '.eq("artist_id", artist.artistId)',
    "resolveProjectAudioUrl(db, project, user.id, artist.artistId)",
  ]);
  await requireSnippets("app/studio/quick-video-actions.ts", [
    "resolveActiveArtistContext",
    "loadVideoProjectContext(db, projectId, user.id, artist.artistId)",
  ]);
  await requireSnippets("app/studio/video-actions.ts", [
    "requireProjectForActiveArtist",
    '.eq("artist_id", artist.artistId)',
  ]);
});
