import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Living Artwork remains the downstream motion continuation of Release Visual", async () => {
  const outcomes = await read("lib/studio/create-outcomes.ts");
  const domain = await read("lib/marketing/living-artwork.ts");
  const releaseVisualActions = await read("app/studio/release-visual-actions.ts");

  assert.match(outcomes, /id: "visual"/);
  assert.match(outcomes, /workflow: "release_visual"/);
  assert.match(releaseVisualActions, /animateApprovedReleaseVisual/);
  assert.match(releaseVisualActions, /living_artwork_source/);
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


test("native loop routing requires identical start and end frame media", async () => {
  const router = await read("lib/marketing/creative-router.ts");
  assert.match(router, /creativeIntent === "seamless_loop"/);
  assert.match(router, /role: "start_image", url: source\.url/);
  assert.match(router, /role: "end_image", url: source\.url/);
  assert.match(router, /supportsStartImage/);
  assert.match(router, /supportsEndImage/);
});

test("Living Artwork UI is staged and exposes zero-spend plus deterministic export paths", async () => {
  const ui = await read("components/studio/living-artwork-workflow.tsx");
  const loopKitPrep = await read("components/studio/living-artwork-loop-kit-prep.tsx");
  const actions = await read("app/studio/living-artwork-actions.ts");

  assert.match(loopKitPrep, /Prepare free Loop Kit/);
  assert.match(ui, /Generate the loop inside Ensemblis instead/);
  assert.match(ui, /Import and check loop/);
  assert.match(ui, /Auto repair seam/);
  assert.match(ui, /Render full-track video/);
  assert.match(ui, /Render short-form video/);
  assert.match(actions, /enqueueLivingArtworkNormalization/);
  assert.match(actions, /enqueueLivingArtworkVisualizer/);
  assert.match(actions, /enqueueLivingArtworkSocial/);
});

test("full-track visualizer repeats video and leaves music processing to delivery encoding only", async () => {
  const worker = await read("services/media-worker/app/loop_visualizer.py");
  const loopHelper = await read("services/media-worker/app/video_loop.py");
  assert.match(loopHelper, /"-stream_loop", "-1", "-i"/);
  assert.match(worker, /duration_source": "canonical_audio_probe"/);
  assert.match(worker, /audio_processing": "delivery_codec_only"/);
  assert.doesNotMatch(worker, /alimiter|loudnorm|acompressor|equalizer/);
});


test("full-track visualizer verifies streams, duration and temporal review evidence", async () => {
  const worker = await read("services/media-worker/app/loop_visualizer.py");
  const loopHelper = await read("services/media-worker/app/video_loop.py");
  const social = await read("services/media-worker/app/social_finishing.py");

  assert.match(worker, /has_video/);
  assert.match(worker, /has_audio/);
  assert.match(worker, /duration_delta_ms/);
  assert.match(worker, /review_frame_results/);
  assert.match(worker, /extract_review_frames/);
  assert.match(loopHelper, /"-stream_loop", "-1", "-i"/);
  assert.match(worker, /looped_video_input_args/);
  assert.match(social, /looped_video_input_args/);
});


test("Loop Kit prepares a deterministic portrait source frame with explicit lineage", async () => {
  const prep = await read("components/studio/living-artwork-loop-kit-prep.tsx");
  const actions = await read("app/studio/living-artwork-actions.ts");
  const context = await read("lib/marketing/creative-context.ts");
  const domain = await read("lib/marketing/living-artwork.ts");

  assert.match(prep, /canvas\.width = WIDTH/);
  assert.match(prep, /canvas\.height = HEIGHT/);
  assert.match(prep, /const WIDTH = 1080/);
  assert.match(prep, /const HEIGHT = 1920/);
  assert.match(prep, /drawContain/);
  assert.match(domain, /LIVING_ARTWORK_SOURCE_FRAME_ROLE = "living_artwork_source_frame"/);
  assert.match(actions, /LIVING_ARTWORK_SOURCE_FRAME_ROLE/);
  assert.match(actions, /source_asset_id/);
  assert.match(context, /living_artwork_source_frame/);
});

test("Living Artwork exposes durable resume and retry behavior", async () => {
  const snapshot = await read("lib/studio/artist-operating-snapshot.ts");
  const today = await read("app/studio/(protected)/page.tsx");
  const media = await read("lib/marketing/living-artwork-media.ts");
  const ui = await read("components/studio/living-artwork-workflow.tsx");

  assert.match(snapshot, /latestVisualCreative/);
  assert.match(snapshot, /\[release-visual:v1/);
  assert.match(snapshot, /\[living-artwork:v1/);
  assert.match(today, /latestVisualCreative/);
  assert.match(media, /reuseOrRetryExistingJob/);
  assert.match(media, /job\.status === "failed"/);
  assert.match(ui, /Retry loop check/);
});


test("Living Artwork preserves an explicit approved 9:16 Release Visual without reframing", async () => {
  const context = await read("lib/marketing/creative-context.ts");
  const workspace = await read("lib/marketing/living-artwork-workspace.ts");
  const prep = await read("components/studio/living-artwork-loop-kit-prep.tsx");
  const actions = await read("app/studio/living-artwork-actions.ts");

  assert.match(context, /role === "living_artwork_source".*score \+= 240/s);
  assert.match(workspace, /exactPortrait: sourceAsset\?\.width === 1080 && sourceAsset\?\.height === 1920/);
  assert.match(prep, /if \(!exactPortrait\)/);
  assert.match(actions, /workspace\.source\.exactPortrait && workspace\.source\.assetId/);
});
