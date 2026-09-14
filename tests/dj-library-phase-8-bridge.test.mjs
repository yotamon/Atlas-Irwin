import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("Phase 8 cloud schema applies pairing, sync revisions and job claims atomically", async () => {
  const migration = await source("supabase/migrations/20260910004500_dj_library_devices.sql");

  assert.ok(migration.includes("claim_dj_library_pairing"));
  assert.ok(migration.includes("for update;"), "pairing must lock the one-time code");
  assert.ok(migration.includes("apply_dj_library_sync_revision"));
  assert.ok(migration.includes("sync_revision_incomplete"));
  assert.ok(migration.includes("dj_library_sync_chunks"));
  assert.ok(migration.includes("claim_dj_library_device_jobs"));
  assert.ok(migration.includes("for update skip locked"));
  assert.ok(migration.includes("claimed_at < now() - interval '2 minutes'"));
  assert.ok(migration.includes("alter table public.dj_library_sync_chunks enable row level security"));
  assert.equal(migration.includes("grant select on public.dj_library_sync_chunks to authenticated"), false);
  assert.equal(migration.includes("grant select on public.dj_library_pairing_codes to authenticated"), false);
});

test("active DJ source scope excludes Serato from contracts and final database constraints", async () => {
  const contract = await source("lib/automix/source-contract.ts");
  const server = await source("lib/dj-library/device-server.ts");
  const types = await source("types/dj-library-bridge-database.ts");
  const finalScope = await source("supabase/migrations/20260910013000_remove_serato_from_dj_library_sources.sql");
  const roadmap = await source("docs/dj-library-set-intelligence-development-plan.md");

  for (const text of [contract, server, types, roadmap]) {
    assert.equal(/serato/i.test(text), false, "active source contracts and roadmap must not advertise Serato");
  }
  assert.ok(finalScope.includes("'local_library', 'rekordbox', 'traktor'"));
  assert.equal(finalScope.includes("'serato'"), false);
});

test("device API accepts only hashed credentials and path-free bounded sync evidence", async () => {
  const server = await source("lib/dj-library/device-server.ts");
  const pair = await source("app/api/dj-library/device/pair/route.ts");
  const sync = await source("app/api/dj-library/device/sync/route.ts");
  const jobs = await source("app/api/dj-library/device/jobs/route.ts");

  assert.ok(server.includes('DEVICE_CREDENTIAL_PREFIX = "enlb_"'));
  assert.ok(server.includes("deviceCredentialHash(credential)"));
  assert.ok(server.includes('.eq("credential_hash", credentialHash)'));
  assert.ok(server.includes('"renderMixPlan"'));
  assert.ok(pair.includes("generateDeviceCredential()"));
  assert.ok(pair.includes("deviceCredentialHash(credential)"));
  assert.ok(sync.includes("assertPathFree(track"));
  assert.ok(sync.includes("MAX_TRACKS_PER_CHUNK = 250"));
  assert.ok(sync.includes("2 * 1024 * 1024"));
  assert.ok(sync.includes("apply_dj_library_sync_revision"));
  assert.ok(jobs.includes("assertPathFree(result"));
});

test("native bridge keeps filesystem authority in Rust and cloud DTOs path-free", async () => {
  const database = await source("apps/library-bridge/src-tauri/src/db.rs");
  const scanner = await source("apps/library-bridge/src-tauri/src/scanner.rs");
  const network = await source("apps/library-bridge/src-tauri/src/network.rs");
  const capabilities = JSON.parse(await source("apps/library-bridge/src-tauri/capabilities/default.json"));

  assert.ok(database.includes("Raw filesystem paths live only in this device-local table"));
  assert.ok(database.includes("file_bindings"));
  assert.ok(scanner.includes("let source_track_id = seed.fingerprint.clone()"));
  assert.ok(network.includes("SYNC_TRACKS_PER_CHUNK: usize = 200"));
  assert.ok(network.includes("cloud did not commit the complete DJ-library revision"));
  assert.ok(network.includes("fn public_job_error(error: &anyhow::Error) -> String"));
  assert.ok(network.includes('"local device execution failed".to_string()'));
  assert.ok(network.includes("Err(error) => failed(job, public_job_error(&error))"));
  assert.equal(network.includes("failed(job, error.to_string())"), false);
  assert.equal(network.includes("error: Some(error.to_string())"), false);
  assert.equal(network.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.deepEqual(capabilities.permissions, ["core:default"]);
  assert.equal(JSON.stringify(capabilities).includes("fs:"), false);
  assert.equal(JSON.stringify(capabilities).includes("shell:"), false);
  assert.equal(JSON.stringify(capabilities).includes("http:"), false);
});

test("native webview uses a strict local-only CSP without unsafe inline execution", async () => {
  const config = JSON.parse(await source("apps/library-bridge/src-tauri/tauri.conf.json"));
  const html = await source("apps/library-bridge/ui/index.html");
  const csp = config.app.security.csp;

  assert.ok(csp.includes("connect-src 'none'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.equal(csp.includes("unsafe-inline"), false);
  assert.equal(/<script(?![^>]*\bsrc=)/.test(html), false, "native HTML must not contain inline script blocks");
  assert.ok(html.includes('src="./app.js"'));
  assert.ok(html.includes('href="./app.css"'));
});

test("Studio exposes explicit pairing and revocation without exposing credential hashes", async () => {
  const route = await source("app/api/studio/dj-library/devices/route.ts");
  const component = await source("components/studio/library-bridge-panel.tsx");
  const page = await source("app/studio/(protected)/music/automix/page.tsx");

  assert.ok(route.includes('action === "create_pairing"'));
  assert.ok(route.includes('action === "revoke"'));
  assert.equal(route.includes('select("*")'), false);
  assert.ok(component.includes("Pair a computer"));
  assert.ok(component.includes("Raw filesystem paths stay inside the native bridge"));
  assert.ok(page.includes("<LibraryBridgePanel"));
  assert.ok(page.includes("<LocalSetBuilderWorkspace"));
});

test("Studio track discovery shares strict planning-readiness validation with the local planner", async () => {
  const route = await source("app/api/studio/dj-library/tracks/route.ts");
  const candidates = await source("lib/automix/source-candidates.ts");

  assert.ok(route.includes("MAX_PAGE_SIZE = 200"));
  assert.ok(route.includes("planningReadiness(row, sourceKind)"));
  assert.ok(route.includes("planningEvidence: row.planning_evidence"));
  assert.ok(candidates.includes('"duration_missing"'));
  assert.ok(candidates.includes('"bpm_missing"'));
  assert.ok(candidates.includes('"key_missing"'));
  assert.ok(candidates.includes("evidence.recordingFingerprint === fingerprint"));
  assert.equal(route.includes("root_path"), false);
  assert.equal(route.includes("credential_hash"), false);
  assert.equal(route.includes("filePath"), false);
});

test("cloud can queue exact content-identity media verification without learning a path", async () => {
  const route = await source("app/api/studio/dj-library/device-jobs/route.ts");

  assert.ok(route.includes('jobType: "resolve_media"'));
  assert.ok(route.includes("recordingFingerprint"));
  assert.ok(route.includes("sourceTrackId"));
  assert.equal(route.includes("filePath"), false);
  assert.equal(route.includes("root_path"), false);
});
