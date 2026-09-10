import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = join(root, "services", "media-worker", "app");
const sandboxPath = join(root, "lib", "media-worker", "sandbox.ts");

function localDependencies(moduleName) {
  const path = join(appRoot, `${moduleName}.py`);
  assert.ok(existsSync(path), `Local Media Worker module is missing: ${moduleName}.py`);
  const source = readFileSync(path, "utf8");
  const dependencies = new Set();

  for (const match of source.matchAll(/^from\s+\.([A-Za-z_][A-Za-z0-9_]*)\s+import\b/gm)) {
    dependencies.add(match[1]);
  }
  for (const match of source.matchAll(/^from\s+\.\s+import\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
    dependencies.add(match[1]);
  }
  return dependencies;
}

function dependencyClosure(entrypoint) {
  const visited = new Set();
  const queue = [entrypoint];
  while (queue.length) {
    const moduleName = queue.shift();
    if (!moduleName || visited.has(moduleName)) continue;
    visited.add(moduleName);
    for (const dependency of localDependencies(moduleName)) {
      if (!visited.has(dependency)) queue.push(dependency);
    }
  }
  return visited;
}

test("Vercel Sandbox bootstrap contains the complete transitive Media Worker module graph", () => {
  const sandbox = readFileSync(sandboxPath, "utf8");
  const bundled = new Set(
    [...sandbox.matchAll(/"app\/([A-Za-z_][A-Za-z0-9_]*\.py)"\s*:/g)]
      .map((match) => match[1].replace(/\.py$/, "")),
  );
  const required = dependencyClosure("runner");
  const missing = [...required].filter((moduleName) => !bundled.has(moduleName)).sort();

  assert.deepEqual(
    missing,
    [],
    `Sandbox bootstrap is missing local Python dependencies: ${missing.join(", ")}`,
  );
});
