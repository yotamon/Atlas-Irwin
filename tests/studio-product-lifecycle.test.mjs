import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Studio has one lifecycle model shared by product execution", () => {
  const lifecycle = read("lib/marketing/release-lifecycle.ts");
  assert.match(lifecycle, /"development"/);
  assert.match(lifecycle, /"upcoming"/);
  assert.match(lifecycle, /"launch_window"/);
  assert.match(lifecycle, /"catalog"/);
  assert.match(lifecycle, /Europe\/Berlin/);
});

test("marketing heartbeat self-heals state before publishing", () => {
  const cron = read("app/api/cron/marketing/route.ts");
  const reconcile = cron.indexOf('runStep("state reconciliation"');
  const publish = cron.indexOf('runStep("publication queue"');
  assert.ok(reconcile >= 0, "cron must reconcile durable product state");
  assert.ok(publish > reconcile, "state reconciliation must happen before external publishing");
});

test("lifecycle execution creates future internal work but keeps publishing approval-gated", () => {
  const execution = read("lib/marketing/lifecycle-execution.ts");
  assert.match(execution, /atlas-deterministic/);
  assert.match(execution, /actual_cost_usd:\s*0/);
  assert.match(execution, /status:\s*"awaiting_approval"/);
  assert.match(execution, /requires_approval:\s*true/);
  assert.match(execution, /relativeDayForFutureOffset/);
  assert.match(execution, /connectedPlatforms/);
});

test("reconciliation retires safe orphan runs without retrying providers", () => {
  const reconciliation = read("lib/marketing/state-reconciliation.ts");
  assert.match(reconciliation, /reconcileOrphanedGenerationRuns/);
  assert.match(reconciliation, /provider_request_id/);
  assert.match(reconciliation, /status:\s*"failed"/);
  assert.match(reconciliation, /No retry was submitted/);
});

test("database playbook skips impossible historical work", () => {
  const migration = read("supabase/migrations/20260902213000_studio_product_lifecycle_hardening.sql");
  assert.match(migration, /status = 'Skipped'/);
  assert.match(migration, /Review the current catalog growth opportunity/);
  assert.match(migration, /r\.release_date >= today_berlin/);
  assert.match(migration, /campaign_phases/);
  assert.match(migration, /reconciledOrphan/);
});

test("Today is the operational command center and Autopilot is behavior", () => {
  const sidebar = read("components/studio/sidebar.tsx");
  const autopilot = read("app/studio/(protected)/autopilot/page.tsx");
  const today = read("app/studio/(protected)/page.tsx");
  assert.doesNotMatch(sidebar, /\/studio\/autopilot/);
  assert.match(autopilot, /redirect\("\/studio"\)/);
  for (const surface of ["Recommended next move", "Needs you", "Working", "Coming up"]) {
    assert.match(today, new RegExp(surface));
  }
  assert.match(today, /deriveNeedsYouQueue/);
  assert.match(today, /\/studio\/needs-you/);
  assert.doesNotMatch(today, /\/100 signal/);
  assert.doesNotMatch(today, /Evidence readiness/);
  assert.doesNotMatch(today, /Working benchmark/);
  assert.doesNotMatch(today, /Artist-learned memory/);
});

test("release workspace hides lifecycle-skipped debt and changes language for catalog", () => {
  const workspace = read("components/studio/release-workspace-v2.tsx");
  assert.match(workspace, /\["Done", "Skipped"\]/);
  assert.match(workspace, /"Rediscover"/);
  assert.match(workspace, /"Distribute"/);
  assert.match(workspace, /Missed historical moments are never recreated/);
});
