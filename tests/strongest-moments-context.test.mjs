import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Strongest Moments separates scoring peaks from musical playback context", async () => {
  const helper = await source("lib/music-intelligence/strongest-moments.ts");
  const preview = await source("components/studio/music-intelligence-preview.tsx");
  const css = await source("components/studio/music-intelligence-preview.module.css");
  const runtime = await source("services/media-worker/app/music_intelligence_v4_runtime.py");

  assert.ok(helper.includes("STRONGEST_MOMENT_MIN_MS = 12_000"));
  assert.ok(helper.includes("STRONGEST_MOMENT_TARGET_MS = 20_000"));
  assert.ok(helper.includes("STRONGEST_MOMENT_MAX_MS = 32_000"));
  assert.ok(helper.includes("STRONGEST_MOMENT_DIVERSITY_GAP_MS = 24_000"));
  assert.ok(helper.includes("STRONGEST_MOMENT_MAX_PER_SECTION_TYPE = 2"));
  assert.ok(helper.includes("overlapMs(candidate, existing) > 0"), "visible strongest moments must not overlap");
  assert.ok(helper.includes("hook_candidates_v3"), "legacy scoring windows must remain available as peak evidence");
  assert.ok(helper.includes("peak_window"), "the short scoring window must remain explicit inside the expanded moment");

  assert.ok(preview.includes("selectStrongestMoments(map)"));
  assert.ok(preview.includes("play musical context"));
  assert.ok(preview.includes("strongestMomentDurationLabel(moment)"));
  assert.ok(preview.includes("moment.peak_window.start_ms"));
  assert.ok(css.includes(".hookOverlay > span > i"), "timeline must distinguish the scoring peak inside its musical context");

  assert.ok(runtime.includes("attach_strongest_moments(result)"), "new worker analyses must persist canonical contextual strongest moments");
});
