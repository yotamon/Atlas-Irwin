import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("release Mission derivation is categorical rather than percentage based", async () => {
  const mission = await source("lib/studio/release-mission.ts");
  for (const snippet of [
    'MissionAttention = "blocking" | "recommended" | "optional"',
    'status: "blocked"',
    'status: "needs_attention"',
    'status: "on_track"',
    '"Add the canonical master"',
    '"Choose the release date"',
    '"Add release artwork"',
    '"Campaign engine needs repair"',
    '"Review the strongest musical Moment"',
  ]) assert.ok(mission.includes(snippet), `Mission model is missing ${snippet}`);
  assert.equal(mission.includes("score"), false, "Mission readiness must not regress to an additive score");
});

test("Today and Release consume the same release Mission model through the Manager read boundary", async () => {
  const today = await source("app/studio/(protected)/page.tsx");
  const snapshot = await source("lib/studio/artist-operating-snapshot.ts");
  const release = await source("components/studio/release-workspace-v2.tsx");
  assert.ok(snapshot.includes("deriveReleaseMission"));
  assert.ok(release.includes("deriveReleaseMission"));
  assert.ok(today.includes("loadArtistOperatingSnapshot"));
  assert.ok(today.includes("Active release Mission"));
  assert.ok(today.includes("View release Mission"));
  assert.ok(snapshot.includes('select("id,title,release_date,active_release,artwork_url,cover_asset,primary_hook,smart_link_url,spotify_url,soundcloud_url,youtube_url,status,is_archived")'));
  assert.ok(snapshot.includes('select("id,release_id,audio_url,is_primary")'));
  assert.ok(snapshot.includes('select("id,release_id,status")'));
  assert.ok(release.includes('label: "Release mission"'));
  assert.equal(release.includes("Workflow readiness"), false);
  assert.equal(release.includes("healthScore"), false);
});

test("safe product copy no longer asks artists to manually scan opportunities from Release", async () => {
  const release = await source("components/studio/release-workspace-v2.tsx");
  assert.ok(release.includes("Review opportunities"));
  assert.equal(release.includes("Scan portfolio opportunities"), false);
});
