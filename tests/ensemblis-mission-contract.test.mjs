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

test("Today and Release share release truth while Today projects the artist's primary Mission", async () => {
  const today = await source("app/studio/(protected)/page.tsx");
  const snapshot = await source("lib/studio/artist-operating-snapshot.ts");
  const release = await source("components/studio/release-workspace-v2.tsx");
  assert.ok(snapshot.includes("deriveReleaseMission"));
  assert.ok(snapshot.includes("deriveArtistMission"));
  assert.ok(release.includes("deriveReleaseMission"));
  assert.ok(today.includes("loadArtistOperatingSnapshot"));
  assert.ok(today.includes("primaryMission?.nextAction"));
  assert.ok(today.includes("primaryMission?.title"));
  assert.ok(today.includes("Primary Mission ·"));
  assert.ok(today.includes('topDecision\n        ? "Needs You"'));
  assert.ok(today.includes("View release Mission"));
  assert.ok(snapshot.includes("primaryGoal: operatingContext.profile.primaryGoal"));
  assert.ok(snapshot.includes("releaseMission: activeMission"));
  assert.ok(snapshot.includes("proposedActions: nextActions"));
  assert.ok(snapshot.includes("completedActions: completedManagerActions"));
  assert.ok(snapshot.includes('from("release_read_model")'));
  assert.ok(snapshot.includes("cover_asset_id"));
  assert.ok(snapshot.includes("smart_link_site_id"));
  assert.ok(snapshot.includes("smart_link_slug"));
  assert.ok(snapshot.includes("spotify_url"));
  assert.ok(snapshot.includes("soundcloud_url"));
  assert.ok(snapshot.includes("youtube_url"));
  assert.ok(snapshot.includes('from("track_read_model")'));
  assert.ok(snapshot.includes("master_audio_asset_id"));
  assert.ok(snapshot.includes('select("id,release_id,status")'));
  assert.ok(release.includes('label: "Release mission"'));
  assert.equal(release.includes("Workflow readiness"), false);
  assert.equal(release.includes("healthScore"), false);
});

test("primary Mission projection stays semantic and reuses Manager evidence without creating parallel state", async () => {
  const mission = await source("lib/studio/artist-mission.ts");
  const today = await source("app/studio/(protected)/page.tsx");

  for (const action of [
    "advance_discovery",
    "advance_release_strategy",
    "advance_gig_strategy",
    "advance_fan_growth",
    "advance_label_strategy",
    "advance_owned_audience",
  ]) assert.ok(mission.includes(action), `Primary Mission is missing Manager action ${action}`);

  assert.ok(mission.includes("releaseProjection"));
  assert.ok(mission.includes("releaseMission.status"));
  assert.ok(mission.includes("managerExecution"));
  assert.ok(mission.includes("prepared > 0"));
  assert.ok(mission.includes('status: "prepared"'));
  assert.ok(mission.includes('source: "strategy"'));
  assert.equal(mission.includes(".from("), false, "Mission projection must remain a pure read model");
  assert.equal(mission.includes(".insert("), false, "Mission projection must not persist a second Mission state");
  assert.equal(mission.includes(".update("), false, "Mission projection must not mutate canonical state");

  assert.ok(today.includes("Keep making music. Ensemblis is managing the next moves."));
  assert.ok(today.includes("primaryMission.kind === \"release\""));
  assert.equal(today.includes("activeMission?.nextAction"), false, "Today should not let release-only Mission semantics own every artist goal");
});

test("safe product copy no longer asks artists to manually scan opportunities from Release", async () => {
  const release = await source("components/studio/release-workspace-v2.tsx");
  assert.ok(release.includes("Review opportunities"));
  assert.equal(release.includes("Scan portfolio opportunities"), false);
});