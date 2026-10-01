import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("shared Media Worker classifies platform capacity separately from job failure", () => {
  const sandbox = read("lib/media-worker/sandbox.ts");
  assert.match(sandbox, /export function isMediaWorkerCapacityError/);
  assert.match(sandbox, /quota\|limit\|billing\|payment\|required\|resource\|402\|429\|hobby/i);
});

test("shared-worker queues defer capacity exhaustion instead of terminally failing jobs", () => {
  const files = [
    "lib/media-worker/queue.ts",
    "lib/mastering/jobs.ts",
    "lib/automix/jobs.ts",
    "lib/automix/previews.ts",
    "lib/marketing/media-worker-queue.ts",
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(source, /isMediaWorkerCapacityError/);
  }

  const mediaQueue = read("lib/media-worker/queue.ts");
  assert.match(mediaQueue, /reason:\s*"capacity"/);

  const mastering = read("lib/mastering/jobs.ts");
  assert.match(mastering, /reason:\s*"capacity"/);

  const automix = read("lib/automix/jobs.ts");
  assert.match(automix, /reason:\s*"capacity"/);

  const previews = read("lib/automix/previews.ts");
  assert.match(previews, /reason:\s*"capacity"/);

  const marketingMedia = read("lib/marketing/media-worker-queue.ts");
  assert.match(marketingMedia, /reason:\s*"capacity"/);
  assert.match(marketingMedia, /attempt_count:\s*job\.attempt_count/);
});

test("marketing heartbeat stops probing shared worker queues after busy or capacity", () => {
  const route = read("app/api/cron/marketing/route.ts");
  assert.match(route, /function sharedWorkerBlocked/);
  assert.match(route, /reason === "busy"/);
  assert.match(route, /reason === "capacity"/);
  assert.match(route, /sharedWorkerBlocked\(mediaWorker\)/);
  assert.match(route, /sharedWorkerBlocked\(mastering\)/);
});

test("marketing heartbeat keeps critical work bounded and rotates maintenance lanes", () => {
  const route = read("app/api/cron/marketing/route.ts");
  assert.match(route, /MARKETING_HEARTBEAT_LANE_COUNT\s*=\s*4/);
  assert.match(route, /processDuePublicationJobs\(2\)/);
  assert.match(route, /processDueOutreachEnrollments\(2\)/);
  assert.match(route, /heartbeatLane/);
  assert.match(route, /switch \(lane\)/);
  assert.doesNotMatch(route, /processApprovedCreativeDerivativeEvents\(\)/);
  assert.doesNotMatch(route, /runMarketingAutomationCycle\(\)/);
  assert.doesNotMatch(route, /executeSafeManagerActions\(\)/);
});

test("marketing automation cycle accepts bounded event and job limits", () => {
  const source = read("lib/marketing/automation.ts");
  assert.match(source, /runMarketingAutomationCycle\([\s\S]*eventLimit/);
  assert.match(source, /jobLimit/);
  assert.match(source, /processMarketingEvents\(eventLimit/);
  assert.match(source, /runDueAutomationJobs\(jobLimit/);
});

test("content factory treats Sandbox capacity exhaustion as degraded retryable state", () => {
  const route = read("app/api/cron/content-factory/route.ts");
  assert.match(route, /isMediaWorkerCapacityError/);
  assert.match(route, /sandbox_capacity_unavailable/);
  assert.match(route, /degraded:\s*true/);
  assert.match(route, /retryable:\s*true/);
});
