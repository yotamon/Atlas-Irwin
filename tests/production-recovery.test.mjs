import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("recovery drill is protected, manual and never publishes production dumps", () => {
  const workflow = read(".github/workflows/database-recovery-drill.yml");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment:\s*Production/);
  assert.match(workflow, /supabase\/setup-cli@v2/);
  assert.match(workflow, /version:\s*2\.111\.0/);
  assert.match(workflow, /supabase db dump[\s\S]*--role-only/);
  assert.match(workflow, /supabase db dump[\s\S]*schema\.sql/);
  assert.match(workflow, /supabase db dump[\s\S]*--data-only/);
  assert.match(workflow, /supabase start/);
  assert.match(workflow, /roles\.sql[\s\S]*schema\.sql[\s\S]*data\.sql/);
  assert.match(workflow, /upgrade\/eligibility/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact/);
  assert.doesNotMatch(workflow, /\$\{\{\s*runner\.temp/);
  assert.match(workflow, /RUNNER_TEMP\/ensemblis-recovery-backup/);
  assert.doesNotMatch(workflow, /db reset\s+--linked/);
});

test("restore drill verifies critical Ensemblis recovery invariants", () => {
  const workflow = read(".github/workflows/database-recovery-drill.yml");
  for (const entity of [
    "auth.users",
    "public.workspaces",
    "public.workspace_memberships",
    "public.artists",
    "public.releases",
    "public.tracks",
    "public.track_vault",
    "public.media_assets",
    "public.automation_jobs",
    "storage.buckets",
    "storage.objects",
  ]) {
    assert.ok(workflow.includes(entity), `missing recovery count for ${entity}`);
  }
  assert.match(workflow, /rls-policy-fingerprint/i);
  assert.match(workflow, /orphan/i);
  assert.match(workflow, /sha256sum/i);
  assert.match(workflow, /storage\/v1\/object/i);
  assert.match(workflow, /supabase stop --no-backup/i);
});

test("backup runbook owns database and Storage recovery separately", () => {
  const runbook = read("docs/operations/backup-and-restore.md");
  assert.match(runbook, /RPO/i);
  assert.match(runbook, /RTO/i);
  assert.match(runbook, /24 hours/i);
  assert.match(runbook, /Storage object bytes/i);
  assert.match(runbook, /do not include Storage object bytes/i);
  assert.match(runbook, /Production/i);
  assert.match(runbook, /database-recovery-drill\.yml/);
  assert.match(runbook, /upgrade eligibility/i);
  assert.match(runbook, /never.*public.*artifact/is);
});

test("production deployment checklist requires recovery evidence before database upgrade", () => {
  const deployment = read("docs/production-deployment.md");
  assert.match(deployment, /backup.*restore/i);
  assert.match(deployment, /upgrade/i);
  assert.match(deployment, /migration parity/i);
});
