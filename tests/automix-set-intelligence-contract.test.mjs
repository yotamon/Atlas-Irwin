import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Journey preservation is enforced beyond the Studio UI", async () => {
  const api = await source("app/api/studio/automix/route.ts");
  const queue = await source("lib/automix/jobs.ts");
  const worker = await source("services/media-worker/app/automix_set_intelligence.py");
  const planner = await source("services/media-worker/app/automix_planner.py");

  assert.ok(api.includes('if (purpose === "journey")'));
  assert.ok(api.includes("mustPlayTrackIds = [...trackIds]"));
  assert.ok(api.includes("targetTrackCount = trackIds.length"));
  assert.ok(queue.includes('const journey = job.purpose === "journey"'));
  assert.ok(queue.includes("must_play_track_ids: journey ? [...job.track_ids]"));
  assert.ok(worker.includes('if purpose == "journey":'));
  assert.ok(worker.includes('must_play = [track.id for track in tracks]'));
  assert.ok(planner.includes('purpose == "journey"'));
});

test("durable DJ queues terminalize poisoned preparation instead of blocking later work", async () => {
  const jobs = await source("lib/automix/jobs.ts");
  const previews = await source("lib/automix/previews.ts");

  assert.ok(jobs.includes("MAX_PREPARATION_SKIPS"));
  assert.ok(jobs.includes("failPlannedPreparation"));
  assert.ok(jobs.includes('.eq("status", "planned")'));
  assert.ok(previews.includes("MAX_PREVIEW_PREPARATION_SKIPS"));
  assert.ok(previews.includes("failPlannedPreviewPreparation"));
  assert.ok(previews.includes("A canonical master changed after this MixPlan was verified"));
});

test("Personal DJ learning and external source contracts remain bounded and versioned", async () => {
  const personalization = await source("lib/automix/personalization.ts");
  const feedback = await source("app/api/studio/automix/feedback/route.ts");
  const callback = await source("app/api/studio/automix/callback/route.ts");
  const worker = await source("services/media-worker/app/automix_set_intelligence.py");
  const sourceContract = await source("lib/automix/source-contract.ts");

  assert.ok(personalization.includes("0.16 * clamp01(confidence)"));
  assert.ok(personalization.includes("Math.min(0.6"));
  assert.ok(personalization.includes('version: "ensemblis.dj-profile.v2"'));
  assert.ok(personalization.includes("tempoMovement"));
  assert.ok(personalization.includes("energyDynamics"));
  assert.ok(feedback.includes('job.data.status !== "completed"'));
  assert.ok(feedback.includes('evidenceType: "plan_feedback"'));
  assert.ok(callback.includes('evidenceType: "plan_edit"'));
  assert.ok(callback.includes('evidenceType: "plan_approval"'));
  assert.ok(callback.includes("Rendering/catalog integrity is authoritative"));
  assert.ok(worker.includes('DJ_PROFILE_VERSION = "ensemblis.dj-profile.v2"'));
  assert.ok(worker.includes("canonical transition planning still owns stretch limits"));
  assert.ok(sourceContract.includes('SOURCE_CONTRACT_VERSION = "ensemblis.automix-source.v1"'));
  assert.ok(sourceContract.includes("raw.version !== SOURCE_CONTRACT_VERSION"));
});

test("only winning terminal AutoMix callbacks own shared Sandbox cleanup", async () => {
  const callback = await source("app/api/studio/automix/callback/route.ts");
  const previewCallback = await source("app/api/studio/automix/previews/callback/route.ts");

  for (const value of [callback, previewCallback]) {
    const duplicateBlock = value.slice(
      value.indexOf('if (["completed", "failed", "cancelled"].includes'),
      value.indexOf('if (status === "running")'),
    );
    assert.ok(duplicateBlock.includes("duplicate: true"));
    assert.equal(duplicateBlock.includes("scheduleCleanup()"), false, "late duplicate callbacks must not stop newly dispatched work");
  }

  assert.ok(previewCallback.includes("PREVIEW_RETENTION_MS"));
  assert.ok(previewCallback.includes("expires_at: expiresAt"));
});
