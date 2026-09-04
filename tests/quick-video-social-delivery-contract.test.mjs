import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

test("short derived renders prefer approved artist-scoped Moments before generic Track Intelligence", async () => {
  const renderer = await read("lib/video-director/render.ts");

  assert.ok(renderer.includes('from("moments")'));
  assert.ok(renderer.includes('.eq("artist_id", release.artist_id)'));
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

  assert.ok(callback.includes("queueQuickVideoSocialPack"));
  assert.ok(callback.includes('render.render_type === "master_16_9"'));
  assert.ok(callback.includes("scheduleQuickVideoSocialDelivery"));
  assert.ok(delivery.includes('brief.workflow_mode !== "quick_video"'));
  assert.ok(delivery.includes('render_type", "master_16_9"'));
  assert.ok(delivery.includes('status", "completed"'));
  assert.ok(delivery.includes("QUICK_VIDEO_DERIVED_RENDER_TYPES"));
});

test("social delivery is retry-safe and never starts new paid AI generations", async () => {
  const renderer = await read("lib/video-director/render.ts");
  const delivery = await read("lib/video-director/social-delivery.ts");
  const actions = await read("app/studio/quick-video-social-actions.ts");

  assert.ok(renderer.includes("queueVideoRenderIfMissing"));
  assert.ok(renderer.includes('.neq("status", "failed")'));
  assert.ok(delivery.includes("queueVideoRenderIfMissing"));
  assert.ok(actions.includes("retryQuickVideoSocialPack"));
  assert.ok(!delivery.includes("prepareShotGenerationRecords"));
  assert.ok(!delivery.includes("submitApprovalEnvelope"));
  assert.ok(!delivery.includes("Higgsfield"));
});

test("Quick Video delivery hides worker plumbing and explains zero-generation-spend derivatives", async () => {
  const panel = await read("components/studio/video-director/quick-video-delivery-panel.tsx");
  const workspace = await read("components/studio/video-director/quick-video-project-workspace.tsx");

  assert.ok(workspace.includes("QuickVideoDeliveryPanel"));
  assert.ok(panel.includes("Approve one film. Ensemblis finishes the delivery pack."));
  assert.ok(panel.includes("They do not submit new paid AI generations."));
  assert.ok(panel.includes("Hero hook"));
  assert.ok(panel.includes("Promo cut"));
  assert.ok(panel.includes("Full vertical cut"));
  assert.ok(panel.includes("Cut from approved Moment"));
  assert.ok(panel.includes("required"));
  assert.ok(panel.includes("approve intelligent reframing"));
  assert.ok(!panel.includes("worker_job_id"));
  assert.ok(!panel.includes("provider_request_id"));
});
