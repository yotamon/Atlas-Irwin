import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { verifyProductionMigrationBatch } from "../scripts/verify-production-migration-batch.mjs";

const local = [
  { version: "20261001004317", name: "mastering_reference_fk_indexes" },
  { version: "20261005003000", name: "living_artwork_media_jobs" },
  { version: "20261006003000", name: "release_visual_derivative_strategy" },
];
const remote = local.slice(0, 1);
const expected = "20261005003000_living_artwork_media_jobs,20261006003000_release_visual_derivative_strategy";

test("manual deployment permits only the exact ordered pending canonical migration set", () => {
  assert.deepEqual(verifyProductionMigrationBatch(local, remote, expected), [
    "20261005003000_living_artwork_media_jobs",
    "20261006003000_release_visual_derivative_strategy",
  ]);
  assert.throws(() => verifyProductionMigrationBatch(local, remote, "20261005003000_living_artwork_media_jobs"), /does not match/);
  assert.throws(() => verifyProductionMigrationBatch(local, remote, expected.split(",").reverse().join(",")), /does not match/);
});

test("manual deploy fails closed on remote drift, missing or malformed requests and empty batches", () => {
  assert.throws(() => verifyProductionMigrationBatch(local, local, expected), /No migrations remain pending/);
  assert.throws(() => verifyProductionMigrationBatch(local, [...remote,{version:"20261002000000",name:"remote_unknown"}], expected), /drifted/);
  assert.throws(() => verifyProductionMigrationBatch(local, remote, "20261005003000_living_artwork_media_jobs,20261005003000_living_artwork_media_jobs"), /duplicates/);
  assert.throws(() => verifyProductionMigrationBatch(local, remote, ""), /nonempty/);
  assert.throws(() => verifyProductionMigrationBatch(local, remote, "20261005003000_living_artwork_media_jobs,not-a-version"), /nonempty/);
});

test("workflow dispatch stays protected by main and Production environment, with exact batch preflight", async () => {
  const workflow = await readFile(new URL("../.github/workflows/database-production.yml", import.meta.url),"utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /inputs\.expected_migrations/);
  assert.match(workflow, /verify-production-migration-batch\.mjs/);
  assert.match(workflow, /check-supabase-migration-parity\.mjs --allow-pending/);
  assert.match(workflow, /supabase db push --dry-run/);
  assert.match(workflow, /supabase db push --yes/);
  assert.match(workflow, /check-supabase-migration-parity\.mjs\s*\n/);
  assert.doesNotMatch(workflow, /--include-all|migration repair|db reset/);
});
