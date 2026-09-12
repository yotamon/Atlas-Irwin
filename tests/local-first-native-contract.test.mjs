import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

const ANALYZER = "ensemblis.library-bridge.analyzer.v1";
const PAYLOAD = "ensemblis.library-bridge.analysis-payload.v1";
const MODEL = "atlas-ti-v4.0.0";

test("track-planning identity is identical across TypeScript, Rust and Python", async () => {
  const [processors, analysis, analyzer, sidecar] = await Promise.all([
    source("lib/platform/processors.ts"),
    source("apps/library-bridge/src-tauri/src/analysis.rs"),
    source("apps/library-bridge/renderer/bridge_analyzer.py"),
    source("apps/library-bridge/renderer/bridge_sidecar.py"),
  ]);

  assert.ok(processors.includes(`processorVersion: "${ANALYZER}"`));
  assert.ok(processors.includes(`outputKinds: ["${PAYLOAD}"]`));
  assert.ok(analysis.includes(`TRACK_PLANNING_PROCESSOR_VERSION: &str = "${ANALYZER}"`));
  assert.ok(analysis.includes(`TRACK_PLANNING_MODEL_VERSION: &str = "${MODEL}"`));
  assert.ok(analysis.includes(`TRACK_PLANNING_SCHEMA_VERSION: &str = "${PAYLOAD}"`));
  assert.ok(analyzer.includes(`ANALYZER_VERSION = "${ANALYZER}"`));
  assert.ok(analyzer.includes(`ANALYSIS_PAYLOAD_VERSION = "${PAYLOAD}"`));
  assert.ok(sidecar.includes("analysisPayloadVersion"));
});

test("versioned local evidence cache cannot fall back to fingerprint-only reuse", async () => {
  const [database, scanner, adr] = await Promise.all([
    source("apps/library-bridge/src-tauri/src/db.rs"),
    source("apps/library-bridge/src-tauri/src/scanner.rs"),
    source("docs/adr/005-recording-media-analysis-identity.md"),
  ]);

  assert.ok(database.includes("analysis_artifacts"));
  for (const dimension of ["processor_id", "processor_version", "model_id", "model_version", "schema_version", "parameters_hash"]) {
    assert.ok(database.includes(dimension), `analysis artifact cache must include ${dimension}`);
  }
  assert.ok(scanner.includes("cached_analysis_artifact"));
  assert.equal(scanner.includes("db.cached_analysis("), false, "scanner must never reuse the legacy cache automatically");
  assert.ok(scanner.includes("legacy_fingerprint_only_cache_is_never_reused_automatically"));
  assert.ok(adr.includes("processor id/version + model id/version + result schema version + parameters hash"));
});

test("local DSP analyzes a verified immutable snapshot instead of mutable source bytes", async () => {
  const analyzer = await source("apps/library-bridge/renderer/bridge_analyzer.py");
  assert.ok(analyzer.includes("def _verified_snapshot"));
  assert.ok(analyzer.includes("digest = hashlib.sha256()"));
  assert.ok(analyzer.includes("os.fsync(writer.fileno())"));
  assert.ok(analyzer.includes("_verified_snapshot(source, snapshot, fingerprint)"));
  assert.ok(analyzer.includes("_standardize(snapshot, wav)"));
  assert.equal(analyzer.includes("_standardize(source, wav)"), false);
});

test("portable project boundary is directory-based, strict, durable and path-free", async () => {
  const [project, database, html, js] = await Promise.all([
    source("apps/library-bridge/src-tauri/src/project.rs"),
    source("apps/library-bridge/src-tauri/src/db.rs"),
    source("apps/library-bridge/ui/index.html"),
    source("apps/library-bridge/ui/app.js"),
  ]);

  assert.ok(project.includes('PROJECT_FORMAT_VERSION: &str = "ensemblis.project.v1"'));
  assert.ok(project.includes('const MANIFEST_NAME: &str = "project.json"'));
  assert.ok(project.includes("deny_unknown_fields"));
  assert.ok(project.includes("create_new(true)"));
  assert.ok(project.includes("file.sync_all()"));
  assert.ok(project.includes("replace_file_atomic"));
  assert.ok(database.includes("project_recording_bindings"));
  assert.ok(database.includes("package_path text not null unique"));
  assert.ok(html.includes(".ensemble lives with you"));
  assert.ok(js.includes('invoke("create_local_project"'));
  assert.ok(js.includes('invoke("open_local_project"'));
  assert.ok(js.includes('invoke("save_local_project"'));
  assert.equal(js.includes("packagePath"), false);
  assert.equal(js.includes("filePath"), false);
});

test("analysis payload schema is strict and versioned", async () => {
  const schema = JSON.parse(await source("contracts/library-bridge-analysis-payload.v1.json"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.properties.version.const, PAYLOAD);
  assert.equal(schema.properties.analyzerVersion.const, ANALYZER);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.metadata.additionalProperties, false);
  assert.equal(schema.properties.beatGrid.additionalProperties, false);
  assert.equal(schema.properties.planningEvidence.additionalProperties, false);
});
