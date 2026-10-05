import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("visual Create outcome owns the Living Artwork workflow", async () => {
  const outcomes = await read("lib/studio/create-outcomes.ts");
  const domain = await read("lib/marketing/living-artwork.ts");

  assert.match(outcomes, /id: "visual"/);
  assert.match(outcomes, /workflow: "living_artwork"/);
  for (const stage of ["source", "motion", "make_loop", "review", "export"]) {
    assert.ok(domain.includes(`"${stage}"`), `missing Living Artwork stage ${stage}`);
  }
  assert.match(domain, /approvedLoopReady.*return "export"/s);
  assert.match(domain, /rawLoopReady.*return "review"/s);
  assert.match(domain, /processing \|\| state\.motionReady.*return "make_loop"/s);
});

test("Loop Kit makes the same visual the first and last frame", async () => {
  const kit = await read("lib/marketing/loop-kit.ts");
  const domain = await read("lib/marketing/living-artwork.ts");

  assert.match(kit, /firstFrameInstruction: "use_source"/);
  assert.match(kit, /lastFrameInstruction: "use_same_source"/);
  assert.match(kit, /sourceFrameUrl/);
  assert.match(kit, /recommendedDurationSeconds/);
  assert.match(domain, /SEAMLESS LOOP CONTRACT/);
  assert.match(domain, /both the first and last frame/);
});

test("Living Artwork reuses canonical media lineage and durable media jobs", async () => {
  const spec = await read("docs/superpowers/specs/2026-10-05-living-artwork-loop-video-design.md");
  assert.match(spec, /media_assets/);
  assert.match(spec, /media_links/);
  assert.match(spec, /generation_runs/);
  assert.match(spec, /normalize_loop_video/);
  assert.match(spec, /render_loop_visualizer/);
});
