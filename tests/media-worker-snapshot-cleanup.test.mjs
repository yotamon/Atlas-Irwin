import test from "node:test";
import assert from "node:assert/strict";
import { legacySandboxNames } from "../scripts/cleanup-legacy-media-worker-snapshots.mjs";

test("legacy snapshot cleanup only targets versioned Media Worker lineages", () => {
  assert.deepEqual(legacySandboxNames("production", 3), [
    "atlas-media-worker-production-v1",
    "atlas-media-worker-production-v2",
    "atlas-media-worker-production-v3",
  ]);
  assert.equal(legacySandboxNames("production", 12).includes("atlas-media-worker-production-g1"), false);
});
