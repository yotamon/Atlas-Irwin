import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const requireFromHere = createRequire(import.meta.url);
const ts = requireFromHere("typescript");
const root = process.cwd();

function compilePlatform() {
  const sourceDirectory = join(root, "lib", "platform");
  const outputDirectory = mkdtempSync(join(tmpdir(), "ensemblis-project-sync-test-"));
  for (const name of readdirSync(sourceDirectory).filter((name) => name.endsWith(".ts") && name !== "supabase-tus-transport.ts")) {
    const output = ts.transpileModule(readFileSync(join(sourceDirectory, name), "utf8"), {
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
  return outputDirectory;
}

function assertTranspiles(relative) {
  const source = readFileSync(join(root, relative), "utf8");
  const output = ts.transpileModule(source, {
    fileName: relative,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      jsx: ts.JsxEmit.Preserve,
    },
    reportDiagnostics: true,
  });
  const errors = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], `${relative} must be syntactically valid TypeScript`);
}

const compiled = compilePlatform();
const projects = requireFromHere(join(compiled, "projects.js"));
const sync = requireFromHere(join(compiled, "sync.js"));

const fingerprint = `sha256:${"a".repeat(64)}`;

function validManifest() {
  return {
    version: "ensemblis.project.v1",
    projectId: "prj_contract",
    title: "Contract Test",
    revision: 0,
    recordings: [{ id: "rec_1", fingerprint }],
    analysisArtifacts: [],
    assets: [],
    updatedAt: "2026-09-13T12:00:00Z",
  };
}

test("portable manifest parser accepts legacy v1 without notes and rejects unknown fields", () => {
  const parsed = projects.parsePortableProjectManifest(validManifest());
  assert.deepEqual(parsed.notes, []);
  assert.throws(
    () => projects.parsePortableProjectManifest({ ...validManifest(), workspaceId: "should-never-be-portable" }),
    /not supported/,
  );
  assert.throws(
    () => projects.parsePortableProjectManifest({
      ...validManifest(),
      recordings: [{ id: "rec_1", fingerprint, filePath: "C:\\Users\\Example\\track.wav" }],
    }),
    /not supported|device-local/,
  );
});

test("mutation and sync parsers fail closed on malformed external JSON", () => {
  const mutation = {
    version: "ensemblis.project-mutation.v1",
    mutationId: "mut_1",
    projectId: "prj_contract",
    baseRevision: 0,
    createdAt: "2026-09-13T12:01:00Z",
    operation: "note.update",
    entityId: "note_1",
    payload: { text: "hello" },
  };
  assert.equal(sync.parseProjectMutation(mutation).mutationId, "mut_1");
  assert.throws(() => sync.parseProjectMutation({ ...mutation, surprise: true }), /not supported/);
  assert.throws(() => sync.parseProjectMutation({ ...mutation, payload: { filePath: "/Users/example/private.wav" } }), /device-local/);
  assert.throws(() => sync.parseProjectSyncEnvelope({
    version: "ensemblis.project-sync.v2",
    projectId: "prj_contract",
    deviceId: "device_1",
    baseRevision: 0,
    mutations: "not-an-array",
  }), /must be an array/);
  assert.throws(() => sync.parseProjectSyncEnvelope({
    version: "ensemblis.project-sync.v2",
    projectId: "prj_contract",
    deviceId: "device_1",
    baseRevision: 0,
    mutations: [mutation],
    mediaSyncPolicy: { projectData: true },
  }), /must be boolean/);
});

test("project sync server and route remain syntax-valid without installing the full app", () => {
  assertTranspiles("lib/project-sync/server.ts");
  assertTranspiles("app/api/studio/projects/sync/route.ts");
  assertTranspiles("types/project-sync-database.ts");
});

test("HTTP project sync scope is derived from authenticated artist context", () => {
  const route = readFileSync(join(root, "app/api/studio/projects/sync/route.ts"), "utf8");
  assert.match(route, /requireStudioAdmin/);
  assert.match(route, /resolveArtistContext/);
  assert.match(route, /workspaceId:\s*artist\.workspaceId/);
  assert.doesNotMatch(route, /body\.workspaceId|searchParams\.get\(["']workspaceId["']\)/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PUT/);
  assert.match(route, /export async function POST/);
});

test("cloud service uses the shared semantic reducer rather than SQL domain logic", () => {
  const server = readFileSync(join(root, "lib/project-sync/server.ts"), "utf8");
  assert.match(server, /applyProjectMutation/);
  assert.match(server, /findProjectMutationConflict/);
  assert.match(server, /projectMutationTarget/);
  assert.match(server, /MAX_CAS_RETRIES/);
  assert.match(server, /log_floor_revision/);
  assert.doesNotMatch(server, /storage\.from|upload\(|bucket|objectKey/);
});

test("project replica migration is server-only, CAS-locked, path-free and metadata-only", () => {
  const migration = readFileSync(join(root, "supabase/migrations/20260913010000_ensemblis_project_sync.sql"), "utf8");
  assert.match(migration, /create table if not exists public\.ensemblis_project_replicas/);
  assert.match(migration, /create table if not exists public\.ensemblis_project_mutations/);
  assert.match(migration, /log_floor_revision/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.ensemblis_project_replicas from anon, authenticated/);
  assert.match(migration, /grant execute on function public\.commit_ensemblis_project_mutation_v1[\s\S]*to service_role/);
  assert.match(migration, /security definer/);
  assert.match(migration, /for update/);
  assert.match(migration, /v_replica\.current_revision <> p_expected_revision/);
  assert.match(migration, /assert_ensemblis_portable_json_v1/);
  assert.match(migration, /workspace_memberships[\s\S]*status = 'active'/);
  assert.match(migration, /p_target <> \('recording:' \|\| p_entity_id\)/);
  assert.doesNotMatch(migration, /audio_blob|media_blob|storage_bucket|object_key|master_audio|stem_blob/);
});
