import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function requireSnippets(path, snippets) {
  const text = await source(path);
  for (const snippet of snippets) {
    assert.ok(text.includes(snippet), `${path} must retain Music ingestion contract: ${snippet}`);
  }
  return text;
}

test("Music owns mastered-track intake instead of routing through Growth", async () => {
  const musicPage = await requireSnippets("app/studio/(protected)/music/page.tsx", [
    'href("/studio/music/import")',
    "Add a mastered track",
    "strongest moments automatically",
  ]);
  assert.doesNotMatch(musicPage, /\/studio\/growth\?view=portfolio/,
    "Music must not send mastered-track intake to Growth/Portfolio");

  const legacyGrowthImport = await source("app/studio/(protected)/growth/import/page.tsx");
  assert.match(legacyGrowthImport, /redirect\("\/studio\/music\/import"\)/,
    "legacy Growth intake must resolve to the Music-owned importer");
});

test("master intake is title plus audio while analysis starts automatically", async () => {
  const importPage = await requireSnippets("app/studio/(protected)/music/import/page.tsx", [
    "musicIntakeMode",
    "Title is optional",
    "starts understanding structure and strongest moments automatically",
    "without asking you to score the song by hand",
  ]);
  assert.doesNotMatch(importPage, /hook_strength|artist_rating|short_form_potential|release_readiness/,
    "Music intake must not expose manual ranking fields");

  await requireSnippets("components/studio/media-uploader.tsx", [
    "musicIntakeMode?: boolean",
    "Drop mastered tracks here",
    "Master added to Music",
    "Track Intelligence starts automatically after upload",
  ]);
});

test("new master state and analysis are explicitly scoped to the active artist", async () => {
  const actions = await requireSnippets("app/studio/growth-media-actions.ts", [
    "resolveActiveArtistContext",
    "artist_id: artist.artistId",
    '.eq("artist_id", artist.artistId)',
    "dispatchAnalysis(track.id, artist.artistId",
    'revalidatePath("/studio/music")',
  ]);
  assert.ok((actions.match(/\.eq\("artist_id", artist\.artistId\)/g) ?? []).length >= 8,
    "master intake, release linking and analysis recovery should stay artist-local");
});

test("Music overview describes understanding instead of portfolio scores", async () => {
  const overview = await requireSnippets("components/studio/music-workspace-overview.tsx", [
    "Track understanding",
    "Understanding ready",
    "Create from this track",
    "Add master",
  ]);
  assert.doesNotMatch(overview, /rankVaultTracks|Portfolio score|Edit portfolio signals|Manage Portfolio/,
    "Music overview must not expose Growth ranking as the primary music model");
});

test("track workspace keeps analysis recovery secondary and removes manual scorecards", async () => {
  const detail = await requireSnippets("app/studio/(protected)/music/[id]/page.tsx", [
    "Recommended next move",
    "Strong moments",
    "analysisNeedsRecovery",
    "Retry Track Intelligence",
    "Nothing to fill in manually",
  ]);
  assert.doesNotMatch(detail, /scoreVaultTrack|Portfolio score|Edit portfolio signals|hook_strength|short_form_potential/,
    "track workspace must explain musical understanding rather than expose manual ranking signals");
}