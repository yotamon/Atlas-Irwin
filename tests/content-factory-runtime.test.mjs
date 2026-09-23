import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("free content factory can bootstrap persistent ffmpeg without a 55-second race", () => {
  const route = read("app/api/cron/content-factory/route.ts");
  assert.match(route, /maxDuration\s*=\s*240/);
  assert.match(route, /COMPOSER_BOOTSTRAP_TIMEOUT_MS\s*=\s*180_000/);
  assert.match(route, /resume:\s*true/);
  assert.match(route, /ffmpeg-static@5\.2\.0/);
  assert.match(route, /fillOneMissingScheduledAsset/);
});

test("database-side content factory caller outlives bootstrap without mutating paid or publish state", () => {
  const migration = read("supabase/migrations/20260902221500_content_factory_timeout_hardening.sql");
  assert.match(migration, /atlas-content-factory-6-hour/);
  assert.match(migration, /timeout_milliseconds\s*:=\s*210000/);
  assert.match(migration, /atlas_marketing_cron_secret/);
  assert.doesNotMatch(migration, /generation_runs|campaign_ai_spend|ai_control_settings|publication_jobs/i);
});


test("free content factory bounds persistent snapshot retention", () => {
  const source = read("lib/marketing/free-content-factory.ts");
  assert.match(source, /SANDBOX_SNAPSHOT_EXPIRATION_MS\s*=\s*7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /snapshotExpiration:\s*SANDBOX_SNAPSHOT_EXPIRATION_MS/);
  assert.match(source, /keepLastSnapshots:\s*\{[\s\S]*count:\s*1,[\s\S]*expiration:\s*SANDBOX_SNAPSHOT_EXPIRATION_MS,[\s\S]*deleteEvicted:\s*true/);
});
