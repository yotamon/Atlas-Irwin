import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("marketing cron delegates maintenance to a bounded durable heartbeat", () => {
  const route = read("app/api/cron/marketing/route.ts");
  assert.match(route, /runDurableMarketingHeartbeat/);
  assert.match(route, /import \{ after \} from "next\/server"/);
  assert.match(route, /after\(async \(\) =>/);
  assert.match(route, /maxDuration\s*=\s*55/);
  assert.match(route, /durable-post-response-heartbeat/);
  for (const direct of [
    "reconcileMarketingState",
    "processDuePublicationJobs",
    "processDueOutreachEnrollments",
    "processAutonomousCreativeSpend",
    "processApprovedCreativeDerivativeEvents",
    "runMarketingAutomationCycle",
    "syncAudienceInteractions",
    "refreshMarketingRadarIfDue",
    "refreshNextBestActions",
    "executeSafeManagerActions",
  ]) {
    assert.doesNotMatch(route, new RegExp(`\\b${direct}\\b`), `cron still directly owns ${direct}`);
  }
});

test("durable marketing heartbeat seeds idempotent artist-scoped maintenance jobs and runs to a deadline", () => {
  const heartbeat = read("lib/marketing/durable-heartbeat.ts");
  const maintenance = read("lib/marketing/maintenance.ts");
  const source = heartbeat + maintenance;
  assert.match(heartbeat, /automation_jobs/);
  assert.match(heartbeat, /idempotency_key/);
  assert.match(heartbeat, /artist_id/);
  assert.match(source, /maintenance:state_reconciliation/);
  assert.match(source, /maintenance:publications/);
  assert.match(source, /maintenance:outreach/);
  assert.match(source, /maintenance:audience_sync/);
  assert.match(source, /maintenance:radar/);
  assert.match(source, /maintenance:next_best_actions/);
  assert.match(source, /maintenance:manager_execution/);
  assert.match(heartbeat, /deadline|budgetMs/);
  assert.match(heartbeat, /runDueAutomationJobsWithinBudget/);
});

test("automation executor claims maintenance work incrementally instead of preclaiming an unbounded batch", () => {
  const automation = read("lib/marketing/automation.ts");
  assert.match(automation, /runDueAutomationJobsWithinBudget/);
  assert.match(automation, /claimDueAutomationJobs\(1/);
  assert.match(automation, /budgetExhausted/);
  assert.match(automation, /maintenance:state_reconciliation/);
  assert.match(automation, /maintenance:publications/);
  assert.match(automation, /maintenance:outreach/);
  assert.match(automation, /maintenance:creative_spend/);
  assert.match(automation, /maintenance:creative_derivatives/);
  assert.match(automation, /maintenance:event_automation/);
});

test("durable automation recovers stale leases and reschedules recurring maintenance", () => {
  const automation = read("lib/marketing/automation.ts");
  assert.match(automation, /AUTOMATION_LEASE_MS/);
  assert.match(automation, /recoverStaleAutomationJobs/);
  assert.match(automation, /\.eq\("status",\s*"running"\)/);
  assert.match(automation, /lease expired/);
  assert.match(automation, /marketingMaintenanceCadenceMs/);
  assert.match(automation, /attempt_count:\s*0/);
  assert.match(automation, /status:\s*"queued"/);
});

test("shared Media Worker distinguishes transient capacity from busy and fatal dispatch failures", () => {
  const failures = read("lib/media-worker/failures.ts");
  assert.match(failures, /MediaWorkerDispatchFailureKind/);
  assert.match(failures, /"capacity"/);
  assert.match(failures, /"busy"/);
  assert.match(failures, /402|429|quota|billing|resource/i);
  assert.match(failures, /retryAfter|retry_after/i);

  const sandbox = read("lib/media-worker/sandbox.ts");
  assert.match(sandbox, /mediaWorkerDispatchFailure/);
});

test("all shared worker queues preserve work when provider capacity is unavailable", () => {
  for (const file of [
    "lib/media-worker/queue.ts",
    "lib/mastering/jobs.ts",
    "lib/mastering/reference-jobs.ts",
    "lib/automix/jobs.ts",
    "lib/automix/previews.ts",
    "lib/marketing/media-worker-queue.ts",
  ]) {
    const source = read(file);
    assert.match(source, /mediaWorkerCapacity|capacity/i, `${file} has no capacity branch`);
    assert.match(source, /status:\s*"planned"|status:\s*"queued"|status:\s*"pending"/, `${file} does not return work to a durable pending state`);
  }
});

test("marketing shared-worker dispatch stops after a capacity result", () => {
  const heartbeat = read("lib/marketing/durable-heartbeat.ts");
  assert.match(heartbeat, /reason\s*===\s*"capacity"|workerBlocked|sharedWorkerBlocked/);
  assert.match(heartbeat, /if \(sharedWorkerBlocked\(mediaWorker\)\) return/);
  assert.match(heartbeat, /kickMasteringReferenceQueue/);
  assert.match(heartbeat, /if \(sharedWorkerBlocked\(masteringReference\)\)[\s\S]*blockedBy: "masteringReference"/);
});

test("Mastering Reference analysis persists provider-capacity backoff and joins every shared-worker recovery path", () => {
  const queue = read("lib/mastering/reference-jobs.ts");
  const cron = read("app/api/cron/media-worker/route.ts");
  const sandbox = read("lib/media-worker/sandbox.ts");

  assert.match(queue, /isMediaWorkerCapacityError/);
  assert.match(queue, /mediaWorkerCapacityBlocked/);
  assert.match(queue, /mediaWorkerCapacityErrorMessage/);
  assert.match(queue, /mediaWorkerCapacityRetryAfter/);
  assert.match(queue, /reason:\s*"capacity"/);
  assert.match(queue, /status:\s*"pending"/);

  assert.match(cron, /kickMasteringReferenceQueue/);
  assert.match(sandbox, /kickMasteringReferenceQueue/);
  assert.doesNotMatch(sandbox, /\bdispatched\s*=\s*result\.dispatched/);
});

test("Content Factory checks for actual work before creating Sandbox and treats quota as deferred", () => {
  const route = read("app/api/cron/content-factory/route.ts");
  assert.doesNotMatch(route, /prepareComposerSandbox/);
  assert.doesNotMatch(route, /Sandbox\.getOrCreate/);
  assert.match(route, /fillOneMissingScheduledAsset/);

  const factory = read("lib/marketing/free-content-factory.ts");
  assert.match(factory, /sandbox_capacity_deferred/);
  assert.match(factory, /quota|402|429|billing|resource/i);
});
