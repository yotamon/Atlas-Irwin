import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const files = {
  migration: "supabase/migrations/20260902224500_ensemblis_distribution.sql",
  hardening: "supabase/migrations/20260902224600_ensemblis_distribution_hardening.sql",
  domain: "lib/distribution/domain.ts",
  provider: "lib/distribution/provider.ts",
  actions: "app/studio/distribution-actions.ts",
  releasePage: "app/studio/(protected)/releases/[id]/distribution/page.tsx",
  hub: "app/studio/(protected)/distribution/page.tsx",
  operations: "app/studio/(protected)/distribution/operations/page.tsx",
  workspace: "components/studio/release-workspace-v2.tsx",
};

test("Distribution ships both artist and operations product surfaces", async () => {
  await Promise.all(Object.values(files).map((path) => access(path)));
  const workspace = await readFile(files.workspace, "utf8");
  assert.ok(workspace.includes(`/distribution`));
  assert.ok(workspace.includes("Music distribution"));
  assert.ok(workspace.includes("Campaign publishing"));
});

test("distribution schema keeps Ensemblis canonical and submission evidence versioned", async () => {
  const migration = await readFile(files.migration, "utf8");
  const hardening = await readFile(files.hardening, "utf8");
  for (const table of [
    "distribution_accounts",
    "distribution_artist_profiles",
    "release_distribution_configs",
    "distribution_submissions",
    "distribution_deliveries",
    "distribution_validation_issues",
    "distribution_events",
  ]) assert.ok(migration.includes(`create table public.${table}`), `${table} missing`);
  assert.ok(migration.includes("unique(release_id, version)"));
  assert.ok(migration.includes("create_distribution_submission"));
  assert.ok(migration.includes("prevent_distribution_submission_update"));
  assert.ok(hardening.includes("drop trigger if exists prevent_distribution_submission_delete"), "release cascades must remain possible");
  assert.ok(hardening.includes("pg_advisory_xact_lock"), "submission version allocation must be serialized");
});

test("Revelator stays behind a provider-neutral boundary and DSP ids are discovered", async () => {
  const provider = await readFile(files.provider, "utf8");
  assert.ok(provider.includes("interface DistributionProvider"));
  assert.ok(provider.includes("listStores()"));
  assert.ok(provider.includes('"/common/lookup/stores"'));
  assert.ok(provider.includes("/supply-chain/v1/releases/${encodeURIComponent(providerReleaseId)}/deliver/validate"));
  assert.ok(provider.includes("/distribution/release/addtoqueue"));
  assert.equal(provider.includes("const storeIds = ["), false, "DSP IDs must not be hardcoded");
});

test("submission is approval-gated, revalidated and snapshotted before external delivery", async () => {
  const actions = await readFile(files.actions, "utf8");
  assert.ok(actions.includes('bool(form, "confirm_submission")'));
  assert.ok(actions.includes("validateContext(context)"));
  const snapshotIndex = actions.indexOf('rpc("create_distribution_submission"');
  const providerSubmitIndex = actions.indexOf("provider.submitRelease", snapshotIndex);
  assert.ok(snapshotIndex > -1 && providerSubmitIndex > snapshotIndex, "snapshot must exist before provider mutation");
  assert.ok(actions.includes("masterRightsConfirmed: bool(form"));
  assert.ok(actions.includes("aiDeclarationConfirmed: bool(form"));
  assert.equal(actions.includes("masterRightsConfirmed: true"), false, "legal ownership must never be auto-attested");
});

test("delivered is not treated as live", async () => {
  const domain = await readFile(files.domain, "utf8");
  assert.ok(domain.includes('["50", "delivered"]'));
  assert.ok(domain.includes('["60", "on store", "live"]'));
  assert.ok(domain.indexOf('["50", "delivered"]') !== domain.indexOf('["60", "on store", "live"]'));
});

test("provider-specific catalog ids stay in internal operations", async () => {
  const releasePage = await readFile(files.releasePage, "utf8");
  const hub = await readFile(files.hub, "utf8");
  const operations = await readFile(files.operations, "utf8");
  assert.equal(releasePage.includes("provider_release_id"), true, "server-side artist route may read the reference for readiness");
  assert.equal(releasePage.includes("Revelator release ID"), false, "artist UI must not expose provider ids");
  assert.equal(hub.includes("Revelator release ID"), false);
  assert.ok(operations.includes("Revelator release ID"));
  assert.ok(operations.includes("Internal only"));
});
