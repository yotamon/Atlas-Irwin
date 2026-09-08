import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("short derived renders prefer approved artist-scoped Moments before generic Track Intelligence", async () => {
  const renderer = await read("lib/video-director/render.ts");

  assert.ok(renderer.includes('from("moments")'));
  assert.ok(renderer.includes("projectArtistId(db, ownerId, project)"));
  assert.ok(renderer.includes('.eq("artist_id", artistId)'));
  assert.ok(renderer.includes('.eq("release_id", project.release_id)'));
  assert.ok(renderer.includes('.eq("track_id", project.track_id)'));
  assert.ok(renderer.includes('.eq("state", "approved")'));
  assert.ok(renderer.includes('source: "approved_moment"'));
  assert.ok(renderer.includes("music_moment_id"));
  assert.ok(renderer.includes("music_moment_label"));
  assert.ok(renderer.includes("approvedMomentHighlight(moments"));
  assert.ok(renderer.includes("?? chooseHighlightWindow"));
});

test("hero and promo cuts diversify approved Moments while keeping the full vertical edit available", async () => {
  const renderer = await read("lib/video-director/render.ts");

  assert.ok(renderer.includes('type === "promo_30"'));
  assert.ok(renderer.includes("overlapRatio(moment, strongest) < 0.45"));
  assert.ok(renderer.includes('"social_9_16", "promo_30", "hook_15"'));
  assert.ok(renderer.includes('case "social_9_16"'));
  assert.ok(renderer.includes('case "promo_30"'));
  assert.ok(renderer.includes('case "hook_15"'));
});

test("Quick Video automatically queues missing social outputs after the completed master", async () => {
  const callback = await read("app/api/video-director/worker/callback/route.ts");
  const delivery = await read("lib/video-director/social-delivery.ts");

  assert.ok(callback.includes("scheduleQuickVideoSocialDelivery"));
  assert.ok(callback.includes("quality.publishReady"));
  assert.ok(callback.includes("queueQuickVideoSocialPack"));
  assert.ok(delivery.includes("QUICK_VIDEO_DERIVED_RENDER_TYPES"));
});

test("social delivery is retry-safe and never starts new paid AI generations", async () => {
  const delivery = await read("lib/video-director/social-delivery.ts");

  assert.ok(delivery.includes("queueVideoRenderIfMissing"));
  assert.ok(delivery.includes("music_video_renders"));
  assert.ok(!delivery.includes("submitVideoGeneration"));
  assert.ok(!delivery.includes("createApprovalEnvelope"));
});

test("Quick Video delivery hides worker plumbing and explains zero-generation-spend derivatives", async () => {
  const workspace = await read("components/studio/video-director/quick-video-workspace.tsx");

  assert.ok(workspace.includes("No additional AI generation spend"));
  assert.ok(!workspace.includes("MEDIA_WORKER"));
  assert.ok(!workspace.includes("worker job"));
});
