import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("background retry policy classifies quota and applies bounded exponential backoff", async () => {
  const policyPath = path.join(root, "lib/media-worker/retry-policy.mjs");
  assert.ok(fs.existsSync(policyPath), "retry policy module must exist");
  const policy = await import(pathToFileURL(policyPath).href);

  assert.equal(policy.classifyBackgroundFailure(new Error("HTTP 402 Hobby quota exhausted")), "capacity");
  assert.equal(policy.classifyBackgroundFailure(new Error("429 resource limit")), "capacity");
  assert.equal(policy.classifyBackgroundFailure(new Error("worker is busy")), "busy");
  assert.equal(policy.classifyBackgroundFailure(new Error("status code 410")), "gone");
  assert.equal(policy.retryDelayMs("capacity", 1), 60 * 60 * 1000);
  assert.equal(policy.retryDelayMs("capacity", 2), 2 * 60 * 60 * 1000);
  assert.equal(policy.retryDelayMs("capacity", 99), 24 * 60 * 60 * 1000);
});

test("marketing media queue persists and respects retry-not-before capacity backoff", () => {
  const source = read("lib/marketing/media-worker-queue.ts");
  assert.match(source, /retryNotBefore/);
  assert.match(source, /withRetryMetadata/);
  assert.match(source, /clearRetryMetadata/);
  assert.match(source, /classifyBackgroundFailure/);
  assert.match(source, /retryDelayMs/);
  assert.match(source, /reason:\s*"backoff"/);
});

test("content factory cron is dispatch-only and never bootstraps Sandbox in the HTTP route", () => {
  const route = read("app/api/cron/content-factory/route.ts");
  assert.doesNotMatch(route, /from "@vercel\/sandbox"/);
  assert.doesNotMatch(route, /ffmpeg-static|prepareComposerSandbox|COMPOSER_BOOTSTRAP_TIMEOUT_MS/);
  assert.match(route, /maxDuration\s*=\s*(?:[12]?\d|30)/);
  assert.match(route, /enqueueOneMissingScheduledAsset/);
  assert.match(route, /dispatchFreeContentFactoryJob/);
});

test("content factory uses automation_jobs and detached Sandbox execution with callback recovery", () => {
  const source = read("lib/marketing/free-content-factory.ts");
  assert.match(source, /free_content_factory_render/);
  assert.match(source, /automation_jobs/);
  assert.match(source, /idempotency_key/);
  assert.match(source, /generation_runs/);
  assert.match(source, /dispatchMediaWorkerJob/);
  assert.match(source, /compose_free_social_asset/);
  assert.match(source, /content-factory\/callback/);
  assert.match(source, /__atlas_callback_token_sha256|__ensemblis_callback_token_sha256/);
  assert.match(source, /run_after/);
});

test("marketing heartbeat has an internal budget and bounded automation slice", () => {
  const route = read("app/api/cron/marketing/route.ts");
  assert.match(route, /MARKETING_HEARTBEAT_BUDGET_MS/);
  assert.match(route, /deferred/);
  assert.match(route, /runMarketingAutomationCycle\([^)]*eventLimit[^)]*jobLimit/s);
  assert.doesNotMatch(route, /runMarketingAutomationCycle\(\)/);
});
