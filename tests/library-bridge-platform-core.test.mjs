import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import test from "node:test";

const repoRoot = process.cwd();
const buildScript = join(repoRoot, "apps", "library-bridge", "build-platform-core.mjs");
const bundlePath = join(repoRoot, "apps", "library-bridge", "ui", "platform-core.js");

execFileSync(process.execPath, [buildScript], {
  cwd: repoRoot,
  stdio: "pipe",
});

function loadCore() {
  const source = readFileSync(bundlePath, "utf8");
  assert.match(source, /GENERATED FILE/);
  assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(/);
  const context = { window: {}, console };
  vm.runInNewContext(source, context, { filename: "platform-core.js" });
  return context.window.EnsemblisPlatformCore;
}

test("desktop platform bundle executes the canonical semantic reducer without eval", () => {
  const core = loadCore();
  assert.equal(typeof core.createProjectMutation, "function");
  assert.equal(typeof core.applyProjectMutation, "function");

  const manifest = {
    version: "ensemblis.project.v1",
    projectId: "prj_desktop",
    title: "Original",
    revision: 0,
    recordings: [],
    analysisArtifacts: [],
    assets: [],
    notes: [],
    updatedAt: "2026-09-14T00:00:00.000Z",
  };
  const mutation = core.createProjectMutation({
    mutationId: "mut_desktop_title",
    projectId: manifest.projectId,
    baseRevision: manifest.revision,
    operation: "project.title.set",
    payload: { title: "Renamed" },
    createdAt: new Date("2026-09-14T00:01:00.000Z"),
  });
  const next = core.applyProjectMutation(manifest, mutation);

  assert.equal(next.title, "Renamed");
  assert.equal(next.revision, 1);
  assert.equal(next.updatedAt, mutation.createdAt);
  assert.equal(core.projectMutationTarget(mutation), "project:title");
});

test("desktop platform bundle keeps semantic mutations path-free", () => {
  const core = loadCore();
  assert.throws(
    () => core.createProjectMutation({
      mutationId: "mut_private_path",
      projectId: "prj_desktop",
      baseRevision: 0,
      operation: "note.update",
      entityId: "note_1",
      payload: { filePath: "/Users/example/private.wav" },
      createdAt: new Date("2026-09-14T00:01:00.000Z"),
    }),
    /device-local/,
  );
});