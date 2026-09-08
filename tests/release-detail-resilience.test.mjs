import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("release track rows tolerate legacy null Music Intelligence payloads", async () => {
  const tracklist = await source("components/studio/release-tracklist.tsx");

  assert.match(tracklist, /function record\(value: unknown\)/);
  assert.match(tracklist, /const profile = record\(vault\.audio_profile\)/);
  assert.match(tracklist, /Object\.keys\(profile\)\.length > 0/);
  assert.doesNotMatch(tracklist, /Object\.keys\(vault\.audio_profile/);
});

test("tracks with an existing master never require a duplicate upload just to get intelligence", async () => {
  const [workspace, action] = await Promise.all([
    source("components/studio/catalog-track-workspace.tsx"),
    source("app/studio/catalog-track-actions.ts"),
  ]);

  assert.match(workspace, /connectCatalogTrackToIntelligence/);
  assert.match(workspace, /No re-upload needed\./);
  assert.match(workspace, /Connect & analyze/);
  assert.match(workspace, /Replace this master instead/);

  assert.match(action, /\.eq\("linked_track_id", track\.id\)/);
  assert.match(action, /linked_release_id: track\.release_id/);
  assert.match(action, /linked_track_id: track\.id/);
  assert.match(action, /media_asset_id: null/);
  assert.match(action, /audio_url: track\.audio_url/);
  assert.match(action, /source: "backfill"/);
  assert.match(action, /analyzeVaultTrack\(analysisForm\)\.catch\(\(\) => undefined\)/);
});

test("release detail keeps canonical release access independent from optional enrichment services", async () => {
  const [page, boundary] = await Promise.all([
    source("app/studio/(protected)/releases/[id]/page.tsx"),
    source("app/studio/(protected)/releases/[id]/error.tsx"),
  ]);

  assert.match(page, /music\.from\("releases"\).*\.maybeSingle\(\)/s);
  assert.match(page, /if \(releaseResult\.error\) throw new Error/);
  assert.match(page, /const campaign = campaignResult\.error \? null : campaignResult\.data/);
  assert.match(page, /const vaultTracks = vaultsResult\.error \? \[\] : vaultsResult\.data \?\? \[\]/);
  assert.match(page, /const safeMoments = momentsError \? \[\] : moments \?\? \[\]/);
  assert.match(page, /const safeTrackLyrics = trackLyricsError \? \[\] : trackLyrics \?\? \[\]/);
  assert.match(page, /if \(providerScheduleError\) throw new Error/);

  assert.match(boundary, /This release could not finish loading/);
  assert.match(boundary, /onClick=\{reset\}/);
  assert.match(boundary, /href="\/studio\/releases"/);
  assert.match(boundary, /No release data was changed/);
});
