import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Studio has one lifecycle model shared by product execution", () => {
  const lifecycle = read("lib/marketing/release-lifecycle.ts");
  const executor = read("lib/marketing/lifecycle-executor.ts");
  const releaseWorkspace = read("components/studio/release-workspace-v2.tsx");
  const growth = read("app/studio/(protected)/growth/page.tsx");
  assert.match(lifecycle, /pre_release/);
  assert.match(lifecycle, /launch/);
  assert.match(lifecycle, /sustain/);
  assert.match(lifecycle, /catalog/);
  assert.match(executor, /releaseLifecycle/);
  assert.match(releaseWorkspace, /releaseLifecycle/);
  assert.match(growth, /releaseLifecycle/);
});

test("marketing heartbeat self-heals state before publishing", () => {
  const heartbeat = read("lib/marketing/heartbeat.ts");
  assert.match(heartbeat, /reconcileMarketingState/);
  assert.match(heartbeat, /executeLifecycleAutomation/);
  assert.match(heartbeat, /executeDuePublicationJobs/);
  assert.ok(heartbeat.indexOf("reconcileMarketingState") < heartbeat.indexOf("executeDuePublicationJobs"));
});

test("lifecycle execution creates future internal work but keeps publishing approval-gated", () => {
  const executor = read("lib/marketing/lifecycle-executor.ts");
  assert.match(executor, /createLifecycleContent/);
  assert.match(executor, /approval_status: "pending"/);
  assert.doesNotMatch(executor, /approval_status: "approved"/);
});

test("reconciliation retires safe orphan runs without retrying providers", () => {
  const reconcile = read("lib/marketing/reconcile.ts");
  assert.match(reconcile, /reconciledOrphan/);
  assert.match(reconcile, /status: "failed"/);
  assert.doesNotMatch(reconcile, /execute.*provider/i);
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