import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = readFileSync(join(root, "lib", "media-worker", "sandbox.ts"), "utf8");

test("Media Worker uses a generation-stable persistent sandbox", () => {
  assert.match(sandbox, /const MEDIA_WORKER_SANDBOX_GENERATION = \d+;/);
  assert.match(
    sandbox,
    /atlas-media-worker-\$\{environmentName\(\)\}-g\$\{MEDIA_WORKER_SANDBOX_GENERATION\}/,
  );
  assert.doesNotMatch(
    sandbox,
    /atlas-media-worker-\$\{environmentName\(\)\}-v\$\{MEDIA_WORKER_RUNTIME_VERSION\}/,
    "ordinary worker releases must not create a new persistent snapshot lineage",
  );
});

test("Media Worker bounds and expires retained snapshots", () => {
  assert.match(sandbox, /const MEDIA_WORKER_SNAPSHOT_EXPIRATION_MS = 7 \* 24 \* 60 \* 60 \* 1000;/);
  assert.match(sandbox, /snapshotExpiration: MEDIA_WORKER_SNAPSHOT_EXPIRATION_MS/);
  assert.match(
    sandbox,
    /keepLastSnapshots:\s*\{\s*count: 1,\s*expiration: MEDIA_WORKER_SNAPSHOT_EXPIRATION_MS,\s*deleteEvicted: true,/s,
  );
});
