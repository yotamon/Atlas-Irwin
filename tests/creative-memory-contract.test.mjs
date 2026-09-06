import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function requireSnippets(path, snippets) {
  const text = await read(path);
  for (const snippet of snippets) {
    assert.ok(text.includes(snippet), `${path} must retain Creative Memory contract: ${snippet}`);
  }
  return text;
}

test("Creative Memory persistence is explicitly artist-scoped and reversible", async () => {
  const migration = await read("supabase/migrations/20260905001500_creative_memory_v1.sql");
  for (const table of ["creative_memory_events", "creative_asset_profiles"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
  }
  assert.match(migration, /artist_id uuid not null references public\.artists/);
  assert.match(migration, /idempotency_key text not null/);
  assert.match(migration, /duplicate_of_asset_id/);
  assert.match(migration, /excluded boolean not null default false/);
  assert.match(migration, /private\.can_access_artist\(artist_id\)/);
});

test("Creative Memory ranking rewards evidence and penalizes rejection, duplicates and exclusions", async () => {
  const domain = await read("lib/creative-memory/domain.ts");
  const server = await read("lib/creative-memory/server.ts");
  for (const token of [
    "approvals",
    "rejections",
    "uses",
    "performanceScore",
    "brandRelevance",
    "excluded",
    "duplicateOfAssetId",
  ]) assert.ok(server.includes(token));
  assert.ok(domain.includes("preferenceStrength"));
  assert.ok(server.includes("duplicatePenalty"));
  assert.ok(server.includes("rejectionPenalty"));
});

test("Video Director consumes artist Creative Memory instead of owner-global preferences", async () => {
  const context = await read("lib/video-director/context.ts");
  assert.ok(context.includes("loadArtistCreativeMemory"));
  assert.ok(context.includes("artistId"));
  assert.ok(context.includes("creativeMemory"));
});

test("Quick Video and shot reviews create durable artist-specific learning evidence", async () => {
  const quick = await read("app/studio/quick-video-actions.ts");
  const video = await read("app/studio/video-actions.ts");
  for (const source of [quick, video]) {
    assert.ok(source.includes("recordCreativeMemoryEvent"));
    assert.ok(source.includes("artistId"));
  }
});

test("Library exposes explainable memory without deleting rejected source media", async () => {
  const page = await read("app/studio/(protected)/library/page.tsx");
  const actions = await read("app/studio/library-actions.ts");
  assert.ok(page.includes("Creative Memory"));
  assert.ok(page.includes("Why"));
  assert.ok(actions.includes("setCreativeAssetExcluded"));
  assert.equal(actions.includes('.from("media_assets").delete()'), false);
});

test("Production surfaces strongest remembered references with reasons before paid generation", async () => {
  const panel = await read("components/studio/creative-production-panel.tsx");
  for (const token of [
    "Creative Memory",
    "context references, not new paid generations",
    "approveCreativeMemoryLookReferences",
    "approveAndGenerateLookDevelopment",
  ]) assert.ok(panel.includes(token));
  assert.ok(panel.indexOf("Creative Memory") < panel.indexOf("Approval envelope"));
  const generation = await read("lib/video-director/generation.ts");
  assert.ok(generation.includes("createApprovalEnvelope"));
  assert.ok(generation.includes("hard_budget_credits"));
  assert.ok(generation.includes("assertSpecialistMediaSpendAllowed"));
});

test("Video project deep links and Quick Video orchestration cannot cross active artists", async () => {
  const page = await requireSnippets("app/studio/(protected)/video/[id]/page.tsx", [
    "resolveActiveArtistContext",
    '.eq("artist_id", artist.artistId)',
    "resolveProjectAudioUrl(db, project, user.id, artist.artistId)",
  ]);
  assert.doesNotMatch(page, /asArtistScopedMusicClient/);
  await requireSnippets("app/studio/quick-video-actions.ts", [
    "resolveActiveArtistContext",
    "loadVideoProjectContext(db, projectId, user.id, artist.artistId)",
  ]);
  await requireSnippets("app/studio/video-actions.ts", [
    "requireProjectForActiveArtist",
    '.eq("artist_id", artist.artistId)',
  ]);
});
