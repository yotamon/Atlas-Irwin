import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Strongest Moments separates scoring peaks from musical playback context", async () => {
  const helper = await source("lib/music-intelligence/strongest-moments.ts");
  const audition = await source("lib/music-intelligence/moment-audition.ts");
  const preview = await source("components/studio/music-intelligence-preview.tsx");
  const css = await source("components/studio/music-intelligence-preview.module.css");
  const runtime = await source("services/media-worker/app/music_intelligence_v4_runtime.py");
  const rhythm = await source("services/media-worker/app/moment_rhythm.py");

  assert.ok(helper.includes("STRONGEST_MOMENT_MIN_MS = 12_000"));
  assert.ok(helper.includes("STRONGEST_MOMENT_TARGET_MS = 20_000"));
  assert.ok(helper.includes("STRONGEST_MOMENT_MAX_MS = 32_000"));
  assert.ok(helper.includes("STRONGEST_MOMENT_DIVERSITY_GAP_MS = 24_000"));
  assert.ok(helper.includes("STRONGEST_MOMENT_MAX_PER_SECTION_TYPE = 2"));
  assert.ok(helper.includes("overlapMs(candidate, existing) > 0"), "visible strongest moments must not overlap");
  assert.ok(helper.includes("hook_candidates_v3"), "legacy scoring windows must remain available as peak evidence");
  assert.ok(helper.includes("peak_window"), "the short scoring window must remain explicit inside the expanded moment");

  assert.ok(audition.includes("selectAuditionMoments"), "Studio must upgrade existing analyses to beat-synced audition windows");
  assert.ok(audition.includes("canonical_beats"), "canonical beat timestamps must be the primary rhythm lock");
  assert.ok(audition.includes("momentFadeDurations"), "Moment playback must use a BPM-aware micro-fade envelope");
  assert.ok(audition.includes("momentAuditionGain"), "Moment playback must expose a smooth gain curve");
  assert.ok(audition.includes("start_anchor"), "beat/downbeat provenance must stay explainable");

  assert.ok(preview.includes("selectAuditionMoments(map)"));
  assert.ok(preview.includes("beat-synced · soft fades"));
  assert.ok(preview.includes("{ smoothMoment: true }"));
  assert.ok(preview.includes("requestAnimationFrame(tickAuditionEnvelope)"));
  assert.ok(preview.includes("momentAuditionGain("));
  assert.ok(preview.includes("strongestMomentDurationLabel(moment)"));
  assert.ok(preview.includes("moment.peak_window.start_ms"));
  assert.ok(css.includes(".hookOverlay > span > i"), "timeline must distinguish the scoring peak inside its musical context");

  assert.ok(runtime.includes("attach_strongest_moments(result)"), "new worker analyses must persist canonical contextual strongest moments");
  assert.ok(runtime.includes("beat_sync_strongest_moments(result)"), "new worker analyses must hard-lock persisted Moment edges to the rhythm grid");
  assert.ok(rhythm.includes("hard_lock_when_canonical_rhythm_grid_available"));
  assert.ok(rhythm.includes("hard_non_overlap_after_sync"));
});
