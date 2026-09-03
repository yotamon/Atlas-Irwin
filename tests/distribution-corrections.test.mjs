import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = {
  identity: "lib/distribution/provider-catalog-identity.ts",
  providerUpdate: "lib/distribution/provider-catalog-update.ts",
  safety: "lib/distribution/update-safety.ts",
  catalogRouter: "app/studio/distribution-catalog-router.ts",
  updateAction: "app/studio/distribution-update-action.ts",
  submitRouter: "app/studio/distribution-submit-router.ts",
  statusRouter: "app/studio/distribution-status-router.ts",
  editRouter: "app/studio/distribution-edit-router.ts",
  facade: "app/studio/distribution-actions.ts",
  lifecycle: "app/studio/(protected)/releases/[id]/distribution/release-distribution-lifecycle.tsx",
};

test("provider-assigned catalog identity is read back and conflicts fail closed", async () => {
  const [identity, status] = await Promise.all([
    readFile(files.identity, "utf8"),
    readFile(files.statusRouter, "utf8"),
  ]);
  assert.ok(identity.includes("/content/release/${encodeURIComponent(providerReleaseId)}"));
  assert.ok(identity.includes("providerTrackId"));
  assert.ok(identity.includes("trackRecordingVersions"));
  assert.ok(identity.includes("audioId"));
  assert.ok(status.includes("if (!localUpc && identity.upc)"));
  assert.ok(status.includes("conflicts with Ensemblis UPC"));
  assert.ok(status.includes("if (row && !localIsrc && providerTrack.isrc)"));
  assert.ok(status.includes("conflicts with Ensemblis ISRC"));
  assert.ok(status.includes("./distribution-status-action"), "identity sync must retain submit+takedown reconciliation");
});

test("in-place corrections preserve UPC track order ISRC and master identity", async () => {
  const safety = await readFile(files.safety, "utf8");
  for (const invariant of ["UPC changed", "track count changed", "track order changed", "ISRC changed", "master audio changed"]) {
    assert.ok(safety.includes(invariant), `${invariant} guard missing`);
  }
  assert.ok(safety.includes("provider UPC has not been synchronized"));
  assert.ok(safety.includes("provider ISRC is not synchronized"));
  assert.ok(safety.includes("takedown and create a new release"));
});

test("existing provider release edits preserve provider track and recording file IDs", async () => {
  const update = await readFile(files.providerUpdate, "utf8");
  assert.ok(update.includes("existingTracks"));
  assert.ok(update.includes("trackId: providerTrackId"));
  assert.ok(update.includes("trackRecordingVersions: versions.map"));
  assert.ok(update.includes("audioId: String(audio.audioId"));
  assert.equal(update.includes("/media/audio/upload"), false, "metadata correction must not upload a replacement master");
  assert.ok(update.includes("Provider correction returned a different release ID"));
  assert.ok(update.includes("/content/release/save"));
});

test("catalog correction persists durable intent before provider mutation", async () => {
  const router = await readFile(files.catalogRouter, "utf8");
  assert.ok(router.includes('`update_catalog:${releaseId}:${packageHash}`'));
  const operation = router.indexOf('operation_type: "update_catalog"');
  const mutation = router.indexOf("updateProviderCatalogRelease(account, input", operation);
  assert.ok(operation > -1 && mutation > operation);
  assert.ok(router.includes('["started", "ambiguous"]'));
  assert.ok(router.includes("will not retry it automatically"));
});

test("correction resend creates a new immutable submission and durable operation before queueing", async () => {
  const [action, submitRouter] = await Promise.all([
    readFile(files.updateAction, "utf8"),
    readFile(files.submitRouter, "utf8"),
  ]);
  assert.ok(action.includes("beginDistributionUpdate"));
  assert.ok(action.includes("submitDistributionUpdate"));
  const snapshot = action.indexOf('rpc("create_distribution_submission"');
  const operation = action.indexOf('operation_type: "submit"', snapshot);
  const mutation = action.indexOf("provider.submitRelease", operation);
  assert.ok(snapshot > -1 && operation > snapshot && mutation > operation);
  assert.ok(action.includes("correctionOfSubmissionId"));
  assert.ok(action.includes("will not retry automatically"));
  assert.ok(submitRouter.includes("updateModeFromProviderMetadata"));
  assert.ok(submitRouter.includes("submitDistributionUpdate(form)"));
});

test("server actions and lifecycle UX enforce correction mode instead of bypassing locks", async () => {
  const [edit, facade, lifecycle] = await Promise.all([
    readFile(files.editRouter, "utf8"),
    readFile(files.facade, "utf8"),
    readFile(files.lifecycle, "utf8"),
  ]);
  assert.ok(edit.includes("EDITABLE_STATES"));
  assert.ok(edit.includes("Start a correction workflow before editing a distributed release"));
  assert.ok(facade.includes('from "./distribution-edit-router"'));
  assert.ok(facade.includes('from "./distribution-catalog-router"'));
  assert.ok(facade.includes('from "./distribution-status-router"'));
  assert.ok(facade.includes('from "./distribution-submit-router"'));
  assert.ok(lifecycle.includes("Start correction"));
  assert.ok(lifecycle.includes("Synchronize package"));
  assert.ok(lifecycle.includes("full preflight"));
  assert.ok(lifecycle.includes("Request takedown"));
});
