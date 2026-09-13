import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const moduleRequire = createRequire(import.meta.url);
const ts = moduleRequire("typescript");

const root = process.cwd();
const contractsDirectory = join(root, "contracts");

function readJson(relative) {
  return JSON.parse(readFileSync(join(root, relative), "utf8"));
}

function compilePlatform() {
  const sourceDirectory = join(root, "lib", "platform");
  const outputDirectory = mkdtempSync(join(tmpdir(), "ensemblis-platform-test-"));
  for (const name of readdirSync(sourceDirectory).filter((name) => name.endsWith(".ts") && name !== "supabase-tus-transport.ts")) {
    const source = readFileSync(join(sourceDirectory, name), "utf8");
    const output = ts.transpileModule(source, {
      fileName: name,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        strict: true,
      },
      reportDiagnostics: true,
    });
    const errors = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    assert.deepEqual(errors, [], `${name} must transpile without TypeScript errors`);
    writeFileSync(join(outputDirectory, name.replace(/\.ts$/, ".js")), output.outputText);
  }
  return { outputDirectory, require: moduleRequire };
}

const compiled = compilePlatform();
const runtime = compiled.require(join(compiled.outputDirectory, "runtime.js"));
const router = compiled.require(join(compiled.outputDirectory, "compute-router.js"));
const projects = compiled.require(join(compiled.outputDirectory, "projects.js"));
const processors = compiled.require(join(compiled.outputDirectory, "processors.js"));
const sync = compiled.require(join(compiled.outputDirectory, "sync.js"));
const tasks = compiled.require(join(compiled.outputDirectory, "tasks.js"));

const sha = `sha256:${"a".repeat(64)}`;
const parametersHash = `sha256:${"b".repeat(64)}`;

for (const contract of [
  "recording.v1.json",
  "media-reference.v1.json",
  "processor-descriptor.v1.json",
  "analysis-envelope.v1.json",
  "runtime-task.v1.json",
  "execution-policy.v1.json",
  "device-capabilities.v1.json",
  "project-manifest.v1.json",
  "project-mutation.v1.json",
  "sync-envelope.v2.json",
  "entitlement-set.v1.json",
  "cost-telemetry.v1.json",
]) {
  test(`${contract} is strict and versioned`, () => {
    const schema = readJson(`contracts/${contract}`);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.match(JSON.stringify(schema), /ensemblis\./);
  });
}

test("portable project state rejects device-local paths", () => {
  const manifest = projects.createProjectManifest({ projectId: "prj_test", title: "Test", now: new Date("2026-09-11T00:00:00Z") });
  manifest.recordings.push({ id: "rec_1", fingerprint: sha, displayName: "Track" });
  projects.assertPortableProjectManifest(manifest);
  assert.throws(
    () => projects.assertPortableProjectManifest({ ...manifest, localPath: "C:\\Users\\Yotam\\Music\\track.wav" }),
    /device-local|localPath is not supported/,
  );
});

test("portable project analysis references preserve full provenance identity", () => {
  const manifest = projects.createProjectManifest({ projectId: "prj_provenance", title: "Provenance", now: new Date("2026-09-11T00:00:00Z") });
  manifest.recordings.push({ id: "rec_1", fingerprint: sha });
  manifest.analysisArtifacts.push({
    artifactId: "artifact_1",
    recordingFingerprint: sha,
    processorId: "dj.track-planning-intelligence",
    processorVersion: "ensemblis.library-bridge.analyzer.v1",
    modelId: "atlas-ti",
    modelVersion: "atlas-ti-v4.0.0",
    schemaVersion: "ensemblis.library-bridge.analysis-payload.v1",
    parametersHash,
  });
  projects.assertPortableProjectManifest(manifest);
  const schema = readJson("contracts/project-manifest.v1.json");
  assert.deepEqual(
    schema.properties.analysisArtifacts.items.required,
    ["artifactId", "recordingFingerprint", "processorId", "processorVersion", "modelId", "modelVersion", "schemaVersion", "parametersHash"],
  );
});

test("automatic routing keeps raw audio local when possible", () => {
  const descriptor = processors.PROCESSOR_REGISTRY["dj.track-planning-intelligence"];
  const decision = router.routeProcessor(descriptor, {
    policy: { ...runtime.DEFAULT_EXECUTION_POLICY, neverUploadAudio: true },
    networkOnline: true,
    availableTargets: new Set(["local_sidecar", "cloud"]),
    media: { local: true, cloud: false, browser: false },
    entitlements: new Set(["cloud.compute"]),
  });
  assert.equal(decision.kind, "selected");
  assert.equal(decision.target, "local_sidecar");
  assert.equal(decision.transfer, "none");
});

test("neverUploadAudio blocks raw-audio cloud transfer", () => {
  const descriptor = processors.PROCESSOR_REGISTRY["media-worker.analyze-audio"];
  const decision = router.routeProcessor(descriptor, {
    policy: { ...runtime.DEFAULT_EXECUTION_POLICY, neverUploadAudio: true },
    networkOnline: true,
    availableTargets: new Set(["cloud"]),
    media: { local: true, cloud: false, browser: false },
    entitlements: new Set(["cloud.compute"]),
  });
  assert.equal(decision.kind, "unavailable");
  assert.match(decision.reason, /audio upload is forbidden/);
});

test("neverUploadAudio still permits cloud execution when media is already cloud-resident", () => {
  const descriptor = processors.PROCESSOR_REGISTRY["media-worker.analyze-audio"];
  const decision = router.routeProcessor(descriptor, {
    policy: { ...runtime.DEFAULT_EXECUTION_POLICY, neverUploadAudio: true },
    networkOnline: true,
    availableTargets: new Set(["cloud"]),
    media: { local: false, cloud: true, browser: false },
    entitlements: new Set(["cloud.compute"]),
  });
  assert.equal(decision.kind, "selected");
  assert.equal(decision.target, "cloud");
  assert.equal(decision.transfer, "none");
});

test("paid compute and entitlement constraints fail closed", () => {
  const descriptor = processors.PROCESSOR_REGISTRY["media-worker.render-master"];
  const decision = router.routeProcessor(descriptor, {
    policy: { ...runtime.DEFAULT_EXECUTION_POLICY, allowPaidCompute: false },
    networkOnline: true,
    availableTargets: new Set(["cloud"]),
    media: { local: false, cloud: true, browser: false },
    entitlements: new Set(),
  });
  assert.equal(decision.kind, "unavailable");
  assert.match(decision.reason, /missing entitlement: cloud\.compute/);
  assert.match(decision.reason, /paid compute is disabled/);
});

test("Media Worker job types all map to stable processor ids", () => {
  const source = readFileSync(join(root, "lib", "media-worker", "contract.ts"), "utf8");
  const listMatch = source.match(/MEDIA_WORKER_JOB_TYPES = \[([\s\S]*?)\] as const/);
  assert.ok(listMatch);
  const jobTypes = [...listMatch[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(jobTypes.sort(), Object.keys(processors.MEDIA_WORKER_PROCESSOR_BY_JOB).sort());
  const contract = readJson("contracts/media-worker.v1.json");
  assert.deepEqual(contract.processorIdsByJobType, processors.MEDIA_WORKER_PROCESSOR_BY_JOB);
});

test("semantic project mutations reject filesystem locators", () => {
  assert.throws(
    () => sync.createProjectMutation({
      mutationId: "mut_1",
      projectId: "prj_1",
      baseRevision: 0,
      operation: "note.update",
      entityId: "note_1",
      payload: { filePath: "/Users/example/private.wav" },
      createdAt: new Date("2026-09-11T00:00:00Z"),
    }),
    /device-local/,
  );
});

test("semantic mutation reducer applies deterministic revisions and notes", () => {
  const manifest = projects.createProjectManifest({ projectId: "prj_1", title: "Original", now: new Date("2026-09-11T00:00:00Z") });
  const mutation = sync.createProjectMutation({
    mutationId: "mut_note",
    projectId: "prj_1",
    baseRevision: 0,
    operation: "note.update",
    entityId: "note_1",
    payload: { text: "Keep the chorus wider." },
    createdAt: new Date("2026-09-11T01:00:00Z"),
  });
  const next = sync.applyProjectMutation(manifest, mutation);
  assert.equal(next.revision, 1);
  assert.equal(next.updatedAt, "2026-09-11T01:00:00.000Z");
  assert.deepEqual(next.notes, [{ id: "note_1", text: "Keep the chorus wider.", updatedAt: "2026-09-11T01:00:00.000Z" }]);
  assert.equal(manifest.revision, 0, "reducer must not mutate the previous manifest");
});

test("semantic rebase accepts independent targets and rejects same-target conflicts", () => {
  const base = projects.createProjectManifest({ projectId: "prj_rebase", title: "Original", now: new Date("2026-09-11T00:00:00Z") });
  const remoteTitle = sync.createProjectMutation({
    mutationId: "mut_remote_title",
    projectId: "prj_rebase",
    baseRevision: 0,
    operation: "project.title.set",
    payload: { title: "Remote title" },
    createdAt: new Date("2026-09-11T01:00:00Z"),
  });
  const current = sync.applyProjectMutation(base, remoteTitle);
  const localNote = sync.createProjectMutation({
    mutationId: "mut_local_note",
    projectId: "prj_rebase",
    baseRevision: 0,
    operation: "note.update",
    entityId: "note_1",
    payload: { text: "Local note" },
    createdAt: new Date("2026-09-11T01:05:00Z"),
  });
  assert.equal(sync.canRebaseProjectMutation(localNote, [remoteTitle]), true);
  const rebased = sync.applyProjectMutation(current, localNote, { appliedSinceBase: [remoteTitle] });
  assert.equal(rebased.revision, 2);
  assert.equal(rebased.title, "Remote title");
  assert.equal(rebased.notes[0].text, "Local note");

  const localTitle = sync.createProjectMutation({
    mutationId: "mut_local_title",
    projectId: "prj_rebase",
    baseRevision: 0,
    operation: "project.title.set",
    payload: { title: "Local title" },
    createdAt: new Date("2026-09-11T01:10:00Z"),
  });
  assert.equal(sync.canRebaseProjectMutation(localTitle, [remoteTitle]), false);
  assert.throws(
    () => sync.applyProjectMutation(current, localTitle, { appliedSinceBase: [remoteTitle] }),
    /conflicts on project:title/,
  );
});

test("removing a recording cascades portable analysis and recording-scoped assets", () => {
  const manifest = projects.createProjectManifest({ projectId: "prj_remove", title: "Remove", now: new Date("2026-09-11T00:00:00Z") });
  manifest.recordings.push({ id: "rec_1", fingerprint: sha });
  manifest.analysisArtifacts.push({
    artifactId: "artifact_1",
    recordingFingerprint: sha,
    processorId: "processor",
    processorVersion: "1",
    modelId: "model",
    modelVersion: "1",
    schemaVersion: "schema.v1",
    parametersHash,
  });
  manifest.assets.push({ id: "asset_1", kind: "artwork", recordingFingerprint: sha });
  const remove = sync.createProjectMutation({
    mutationId: "mut_remove",
    projectId: "prj_remove",
    baseRevision: 0,
    operation: "recording.remove",
    entityId: "rec_1",
    createdAt: new Date("2026-09-11T02:00:00Z"),
  });
  const next = sync.applyProjectMutation(manifest, remove);
  assert.deepEqual(next.recordings, []);
  assert.deepEqual(next.analysisArtifacts, []);
  assert.deepEqual(next.assets, []);
});

test("runtime task builder preserves processor identity and idempotency", () => {
  const task = tasks.createRuntimeTask({
    id: "task_1",
    idempotencyKey: "idem_1",
    processorId: "dj.track-planning-intelligence",
    processorVersion: "ensemblis.library-bridge.analyzer.v1",
    policy: runtime.DEFAULT_EXECUTION_POLICY,
  });
  assert.equal(task.version, "ensemblis.runtime-task.v1");
  assert.deepEqual(task.processor, {
    id: "dj.track-planning-intelligence",
    version: "ensemblis.library-bridge.analyzer.v1",
  });
  assert.equal(task.idempotencyKey, "idem_1");
});

test("new portable contracts never define local filesystem path fields", () => {
  const forbidden = new Set(["path", "filePath", "file_path", "localPath", "local_path", "location", "fileUri", "file_uri", "rootPath", "root_path"]);
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      assert.ok(!forbidden.has(key), `contract must not define local field ${key}`);
      walk(nested);
    }
  }
  for (const name of readdirSync(contractsDirectory).filter((name) => /^(recording|media-reference|analysis-envelope|runtime-task|project-|sync-envelope|cost-telemetry)/.test(name))) {
    walk(readJson(`contracts/${name}`));
  }
});
