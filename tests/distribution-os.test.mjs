import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const files = {
  migration: "supabase/migrations/20260902224500_ensemblis_distribution.sql",
  hardening: "supabase/migrations/20260902224600_ensemblis_distribution_hardening.sql",
  catalogMigration: "supabase/migrations/20260902231500_distribution_catalog_metadata.sql",
  domain: "lib/distribution/domain.ts",
  provider: "lib/distribution/provider.ts",
  providerAccount: "lib/distribution/provider-account.ts",
  providerLifecycle: "lib/distribution/provider-lifecycle.ts",
  actions: "app/studio/distribution-core-actions.ts",
  catalogAction: "app/studio/distribution-catalog-action.ts",
  takedownAction: "app/studio/distribution-takedown-action.ts",
  actionFacade: "app/studio/distribution-actions.ts",
  releasePage: "app/studio/(protected)/releases/[id]/distribution/release-distribution-page.tsx",
  routePage: "app/studio/(protected)/releases/[id]/distribution/page.tsx",
  hub: "app/studio/(protected)/distribution/page.tsx",
  operations: "app/studio/(protected)/distribution/operations/page.tsx",
  workspace: "components/studio/release-workspace-v2.tsx",
  styles: "app/studio/distribution-release.css",
};

test("Distribution ships the artist workflow, global hub, operations recovery and release lifecycle integration", async () => {
  await Promise.all(Object.values(files).map((path) => access(path)));
  const [workspace, releasePage, operations] = await Promise.all([
    readFile(files.workspace, "utf8"),
    readFile(files.releasePage, "utf8"),
    readFile(files.operations, "utf8"),
  ]);
  assert.ok(workspace.includes(`/distribution`));
  assert.ok(workspace.includes("Music distribution"));
  assert.ok(workspace.includes("Campaign publishing"));
  for (const label of ["Rights & provenance", "Track metadata & credits", "Artist identity", "Provider package", "Preflight findings", "Final approval"]) {
    assert.ok(releasePage.includes(label), `${label} missing from artist distribution workflow`);
  }
  assert.ok(operations.includes("Recovery only"));
  assert.ok(operations.includes("ambiguous external writes") || operations.includes("ambiguous provider operations"));
});

test("distribution schema keeps Ensemblis canonical and immutable submission evidence versioned", async () => {
  const [migration, hardening, catalog] = await Promise.all([
    readFile(files.migration, "utf8"),
    readFile(files.hardening, "utf8"),
    readFile(files.catalogMigration, "utf8"),
  ]);
  for (const table of [
    "distribution_accounts",
    "distribution_artist_profiles",
    "release_distribution_configs",
    "distribution_submissions",
    "distribution_deliveries",
    "distribution_validation_issues",
    "distribution_events",
  ]) assert.ok(migration.includes(`create table public.${table}`), `${table} missing`);
  for (const table of [
    "distribution_track_metadata",
    "distribution_track_writers",
    "distribution_track_contributors",
    "distribution_provider_operations",
  ]) assert.ok(catalog.includes(`create table public.${table}`), `${table} missing`);
  assert.ok(migration.includes("unique(release_id, version)"));
  assert.ok(migration.includes("create_distribution_submission"));
  assert.ok(migration.includes("prevent_distribution_submission_update"));
  assert.ok(hardening.includes("drop trigger if exists prevent_distribution_submission_delete"), "release cascades must remain possible");
  assert.ok(hardening.includes("pg_advisory_xact_lock"), "submission version allocation must be serialized");
  assert.ok(catalog.includes("operation_type in ('prepare_catalog','submit','update_catalog','takedown')"));
  assert.ok(catalog.includes("where state in ('started','ambiguous')"), "ambiguous external operations need an indexed recovery queue");
});

test("Revelator stays behind a provider-neutral boundary and catalog IDs are discovered dynamically", async () => {
  const provider = await readFile(files.provider, "utf8");
  assert.ok(provider.includes("interface DistributionProvider"));
  assert.ok(provider.includes("listStores()"));
  assert.ok(provider.includes("prepareRelease(input: ProviderCatalogRelease)"));
  assert.ok(provider.includes("/common/lookup/stores?activeOnly=true"));
  assert.ok(provider.includes("/common/lookup/languages"));
  assert.ok(provider.includes("/common/lookup/musicstyles"));
  assert.ok(provider.includes("/common/lookup/contributorRoles"));
  assert.ok(provider.includes("/common/lookup/trackProperties"));
  assert.ok(provider.includes("/supply-chain/v1/releases/${encodeURIComponent(providerReleaseId)}/deliver/validate"));
  assert.ok(provider.includes("/distribution/release/addtoqueue"));
  assert.equal(provider.includes("const storeIds = ["), false, "DSP IDs must not be hardcoded");
  assert.equal(provider.includes("trackProperties: [8]"), false, "AI property IDs must come from the provider lookup");
});

test("provider catalog preparation uploads lossless masters, artwork, writers and production credits", async () => {
  const provider = await readFile(files.provider, "utf8");
  const catalogAction = await readFile(files.catalogAction, "utf8");
  assert.ok(provider.includes("/media/audio/upload"));
  assert.ok(provider.includes("/media/image/upload?cover=true"));
  assert.ok(provider.includes("/content/release/save"));
  assert.ok(provider.includes("/content/release/retail/save"));
  assert.ok(provider.includes("must use a lossless WAV or FLAC master"));
  assert.ok(provider.includes("Production & Engineering credit"));
  assert.ok(provider.includes("Writer shares for"));
  assert.ok(catalogAction.includes("distribution_track_metadata"));
  assert.ok(catalogAction.includes("distribution_track_writers"));
  assert.ok(catalogAction.includes("distribution_track_contributors"));
  assert.ok(catalogAction.includes("previouslyReleased"));
  assert.ok(catalogAction.includes("existing UPC"), "existing catalog must preserve its UPC instead of minting a new one");
});

test("hybrid V1/V2 supply-chain settings are reapplied after retail and UGC policies are per-track", async () => {
  const provider = await readFile(files.provider, "utf8");
  const configureIndex = provider.indexOf("async configureRelease(providerReleaseId");
  const retailIndex = provider.indexOf("/content/release/retail/save", configureIndex);
  const territoryIndex = provider.indexOf("/territories-clearances", retailIndex);
  const pricingIndex = provider.indexOf("this.configureDefaultPricing(providerReleaseId)", retailIndex);
  const monetizationIndex = provider.indexOf("this.configureMonetization(providerReleaseId, options.ugcEnabled)", retailIndex);
  assert.ok(configureIndex > -1 && retailIndex > configureIndex && territoryIndex > retailIndex && pricingIndex > retailIndex && monetizationIndex > retailIndex, "V1 retail must run before every V2 supply-chain setting in configureRelease");
  assert.ok(provider.includes("/supply-chain/v1/monetization-policies"));
  assert.ok(provider.includes("monetizationPolicies: selectedPolicies.map"));
  assert.ok(provider.includes("order === 1"), "UGC enabled should use the provider-declared default policy rather than a hardcoded ID");
  assert.ok(provider.includes("library only") && provider.includes("not eligible"), "UGC disabled must map a safe non-monetizing policy dynamically");
  assert.ok(provider.includes("JSON.stringify({ release: [], assets: [] })"), "worldwide availability should be represented as no territory exceptions");
});

test("catalog creation and updates are duplicate-safe under ambiguous provider outcomes", async () => {
  const catalogAction = await readFile(files.catalogAction, "utf8");
  assert.ok(catalogAction.includes('`prepare_catalog:${releaseId}`'));
  assert.ok(catalogAction.includes('`update_catalog:${releaseId}:${packageHash}`'));
  assert.ok(catalogAction.includes('["started", "ambiguous"]'));
  assert.ok(catalogAction.includes("will not risk creating a duplicate release"));
  const startIndex = catalogAction.indexOf("operation_type: operationType");
  const providerMutationIndex = catalogAction.indexOf("provider.prepareRelease(input)", startIndex);
  assert.ok(startIndex > -1 && providerMutationIndex > startIndex, "provider operation evidence must be written before the external catalog mutation");
});

test("child-account support uses stable unattended identity and never stores the generated provider password", async () => {
  const providerAccount = await readFile(files.providerAccount, "utf8");
  assert.ok(providerAccount.includes("/partner/account/signup"));
  assert.ok(providerAccount.includes("/partner/account/login"));
  assert.ok(providerAccount.includes("partnerUserId = input.ownerId"));
  assert.ok(providerAccount.includes('type: "Growth"'));
  assert.ok(providerAccount.includes("randomBytes(32)"));
  assert.ok(providerAccount.includes("loginChild(partnerUserId)"), "ambiguous/duplicate signup must be recoverable via stable unprompted login");
  assert.equal(providerAccount.includes("providerPassword"), false, "provider password must never be persisted as application state");
});

test("submission is approval-gated, revalidated, snapshotted and ambiguity-safe before external delivery", async () => {
  const actions = await readFile(files.actions, "utf8");
  assert.ok(actions.includes('bool(form, "confirm_submission")'));
  assert.ok(actions.includes("validateContext(context)"));
  const snapshotIndex = actions.indexOf('rpc("create_distribution_submission"');
  const operationIndex = actions.indexOf('operation_type: "submit"', snapshotIndex);
  const providerSubmitIndex = actions.indexOf("provider.submitRelease", operationIndex);
  assert.ok(snapshotIndex > -1 && operationIndex > snapshotIndex && providerSubmitIndex > operationIndex, "snapshot and durable provider-operation evidence must exist before provider mutation");
  assert.ok(actions.includes("submit_ambiguous"));
  assert.ok(actions.includes("will not retry automatically"));
  assert.ok(actions.includes("masterRightsConfirmed: bool(form"));
  assert.ok(actions.includes("aiDeclarationConfirmed: bool(form"));
  assert.equal(actions.includes("masterRightsConfirmed: true"), false, "legal ownership must never be auto-attested");
});

test("takedown dry-runs first, records intent before mutation and never retries an ambiguous destructive result", async () => {
  const [lifecycle, action, domain] = await Promise.all([
    readFile(files.providerLifecycle, "utf8"),
    readFile(files.takedownAction, "utf8"),
    readFile(files.domain, "utf8"),
  ]);
  assert.ok(lifecycle.includes("/takedown/validate"), "provider dry-run endpoint must be used before takedown");
  assert.ok(lifecycle.includes("/distribution/release/removefromstore"), "provider takedown endpoint must be implemented");
  assert.ok(action.includes('bool(form, "confirm_takedown")'), "destructive removal must require explicit confirmation");
  const validationIndex = action.indexOf("validateTakedown(config.provider_release_id, storeIds)");
  const operationIndex = action.indexOf('operation_type: "takedown"', validationIndex);
  const mutationIndex = action.indexOf("takedownRelease(config.provider_release_id, storeIds)", operationIndex);
  assert.ok(validationIndex > -1 && operationIndex > validationIndex && mutationIndex > operationIndex, "validated durable intent must precede the destructive provider write");
  assert.ok(action.includes("will not retry it automatically"));
  assert.ok(action.includes("will not retry automatically; reconcile provider status"));
  assert.ok(domain.includes('"78"') && domain.includes('return "takedown_pending"'), "provider takedown delivery must remain pending until store removal is confirmed");
  assert.ok(domain.includes('"79"') && domain.includes('return "taken_down"'), "only confirmed store removal should become taken_down");
});

test("UGC, AI voice authorization and copyright identity are blocking legal readiness inputs", async () => {
  const domain = await readFile(files.domain, "utf8");
  const releasePage = await readFile(files.releasePage, "utf8");
  assert.ok(domain.includes("rights.ugc_incomplete"));
  assert.ok(domain.includes("ai.voice_authorization"));
  assert.ok(domain.includes("rights.copyright_identity"));
  assert.ok(releasePage.includes("product_copyright_holder"));
  assert.ok(releasePage.includes("recording_copyright_holder"));
  assert.ok(releasePage.includes("ugc_exclusive_master_confirmed"));
  assert.ok(releasePage.includes("voice_authorization_confirmed"));
});

test("delivered is never treated as live", async () => {
  const domain = await readFile(files.domain, "utf8");
  const deliveredIndex = domain.indexOf('["50", "delivered"]');
  const liveIndex = domain.indexOf('["60", "on store"');
  assert.ok(deliveredIndex > -1, "provider status 50 must map to delivered");
  assert.ok(liveIndex > -1, "provider status 60 must map to live/on-store");
  assert.notEqual(deliveredIndex, liveIndex);
  assert.ok(domain.indexOf('return "delivered"', deliveredIndex) > deliveredIndex);
  assert.ok(domain.indexOf('return "live"', liveIndex) > liveIndex);
});

test("provider IDs never enter the artist UX and manual linking is recovery-only", async () => {
  const [releasePage, hub, operations, routePage] = await Promise.all([
    readFile(files.releasePage, "utf8"),
    readFile(files.hub, "utf8"),
    readFile(files.operations, "utf8"),
    readFile(files.routePage, "utf8"),
  ]);
  assert.equal(releasePage.includes("Revelator release ID"), false, "artist UI must not expose provider IDs");
  assert.equal(releasePage.includes("Existing provider release ID"), false, "artist UI must not expose recovery fields");
  assert.equal(hub.includes("Revelator release ID"), false);
  assert.ok(operations.includes("Existing provider release ID"));
  assert.ok(operations.includes("Recovery only"));
  assert.ok(operations.includes("not the normal preparation path"));
  assert.ok(routePage.includes("release-distribution-page"), "route should delegate to the typed artist workspace implementation");
});
