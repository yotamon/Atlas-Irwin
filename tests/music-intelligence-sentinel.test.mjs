import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("All-In-One start/end sentinels can never become canonical production sections", async () => {
  const sanitizer = await readFile("lib/music-intelligence/sanitize.ts", "utf8");
  const vaultCallback = await readFile("app/api/studio/growth/audio-callback/route.ts", "utf8");
  const videoCallback = await readFile("app/api/video-director/worker/callback/route.ts", "utf8");

  assert.ok(sanitizer.includes('label === "start" || label === "end"'));
  assert.ok(sanitizer.includes("removedSectionIds"));
  assert.ok(sanitizer.includes("hook_candidates"));
  assert.ok(sanitizer.includes("social_cut_options"));
  assert.ok(sanitizer.includes("social_cuts"));
  assert.ok(sanitizer.includes("transition into end"));
  assert.ok(sanitizer.includes("sentinel boundaries were excluded"));

  assert.ok(vaultCallback.includes("sanitizeMusicIntelligenceMap(rawMusicMap)"));
  assert.ok(videoCallback.includes("sanitizeMusicIntelligenceMap(rawMusicMap)"));
  assert.ok(videoCallback.includes("sanitizedResult"));
  assert.ok(vaultCallback.indexOf("sourceMatchesTrack(rawMusicMap, track)") < vaultCallback.indexOf("sanitizeMusicIntelligenceMap(rawMusicMap)"));
  assert.ok(videoCallback.indexOf("analysisMatchesCurrentMaster(db, job.project_id, rawMusicMap)") < videoCallback.indexOf("sanitizeMusicIntelligenceMap(rawMusicMap)"));
});
