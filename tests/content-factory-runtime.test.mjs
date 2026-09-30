import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("free content factory cron schedules durable detached work inside a short request window", () => {
  const route = read("app/api/cron/content-factory/route.ts");
  const factory = read("lib/marketing/free-content-factory.ts");

  assert.match(route, /maxDuration\s*=\s*(?:[12]?\d|30)/);
  assert.doesNotMatch(route, /COMPOSER_BOOTSTRAP_TIMEOUT_MS|prepareComposerSandbox|ffmpeg-static/);
  assert.match(route, /enqueueOneMissingScheduledAsset/);
  assert.match(route, /dispatchFreeContentFactoryJob/);

  assert.match(factory, /free_content_factory_render/);
  assert.match(factory, /automation_jobs/);
  assert.match(factory, /dispatchMediaWorkerJob/);
  assert.match(factory, /compose_free_social_asset/);
});

test("database-side content factory caller no longer depends on a long HTTP render window", () => {
  const migration = read("supabase/migrations/20260902221500_content_factory_timeout_hardening.sql");
  assert.match(migration, /atlas-content-factory-6-hour/);
  assert.match(migration, /atlas_marketing_cron_secret/);
  assert.doesNotMatch(migration, /generation_runs|campaign_ai_spend|ai_control_settings|publication_jobs/i);
});

test("free content factory still bounds persistent snapshot retention", () => {
  const source = read("lib/marketing/free-content-factory.ts");
  assert.match(source, /SANDBOX_SNAPSHOT_EXPIRATION_MS\s*=\s*7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /snapshotExpiration:\s*SANDBOX_SNAPSHOT_EXPIRATION_MS/);
  assert.match(source, /keepLastSnapshots:\s*\{[\s\S]*count:\s*1,[\s\S]*expiration:\s*SANDBOX_SNAPSHOT_EXPIRATION_MS,[\s\S]*deleteEvicted:\s*true/);
});
