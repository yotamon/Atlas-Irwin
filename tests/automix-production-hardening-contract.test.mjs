import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("failed approved renders retry the exact frozen MixPlan instead of replanning", async () => {
  const route = await source("app/api/studio/automix/plans/route.ts");
  const recovery = await source("components/studio/automix-render-recovery.tsx");

  assert.ok(route.includes('action === "retry_render"'));
  assert.ok(route.includes('parent.status !== "failed"'));
  assert.ok(route.includes('requestPayload.execution_mode !== "approved_render"'));
  assert.ok(route.includes("approvedMixplan: frozen"));
  assert.ok(route.includes("retry_of_job_id: parent.id"));
  assert.ok(route.includes("frozenManifestStillMatchesCatalog"));
  assert.ok(route.includes("Build a new verified plan instead of retrying stale instructions"));
  assert.ok(recovery.includes('action: "retry_render"'));
  assert.ok(recovery.includes("Retry exact render"));
  assert.ok(recovery.includes('latestApprovedRender?.status === "failed"'));
});

test("MixPlan declares a renderer contract and unknown future contracts fail closed", async () => {
  const manifest = await source("services/media-worker/app/automix_manifest.py");

  assert.ok(manifest.includes('RENDER_ENGINE_CONTRACT_VERSION = "ensemblis.offline-audio-render.v1"'));
  assert.ok(manifest.includes('"render_engine_contract_version": RENDER_ENGINE_CONTRACT_VERSION'));
  assert.ok(manifest.includes("SUPPORTED_RENDER_ENGINE_CONTRACT_VERSIONS"));
  assert.ok(manifest.includes("Unsupported render engine contract"));
  assert.ok(manifest.includes("Missing is accepted as the original v1 contract for reproducibility"));
});

test("AutoMix emits runtime cost proxies and mix-level QA diagnostics without changing DSP", async () => {
  const worker = await source("services/media-worker/app/automix.py");

  assert.ok(worker.includes('RENDERER_VERSION = "ensemblis.media-worker.automix.v1"'));
  assert.ok(worker.includes('"version": "ensemblis.automix-execution-metrics.v1"'));
  assert.ok(worker.includes('"realtime_factor": realtime_factor'));
  assert.ok(worker.includes('"wall_time_ms": wall_ms'));
  assert.ok(worker.includes('"version": "ensemblis.automix-qa.v1"'));
  assert.ok(worker.includes('"max_abs_stretch_delta"'));
  assert.ok(worker.includes('"source_fingerprint_count"'));
  assert.ok(worker.includes('"low_confidence_transition_count"'));
  assert.ok(worker.includes('"render_engine_contract_version": RENDER_ENGINE_CONTRACT_VERSION'));
});

test("render retries preserve history instead of mutating the failed attempt", async () => {
  const route = await source("app/api/studio/automix/plans/route.ts");
  const retryBlock = route.slice(
    route.indexOf('if (action === "retry_render")'),
    route.indexOf('const manifest = planManifest(parent)'),
  );

  assert.ok(retryBlock.includes("insertJob({"));
  assert.ok(retryBlock.includes('executionMode: "approved_render"'));
  assert.ok(retryBlock.includes("parent_job_id: parent.id"));
  assert.equal(retryBlock.includes('.update({ status: "planned"'), false);
});
