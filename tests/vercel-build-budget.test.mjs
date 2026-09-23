import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeploymentNeutralPath, shouldIgnoreDeployment } from "../scripts/vercel-ignore-build.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("deployment-neutral changes do not spend a Vercel build", () => {
  for (const path of [
    "docs/marketing/README.md",
    ".github/workflows/ci.yml",
    "tests/example.test.mjs",
    "e2e/studio.spec.ts",
    "apps/library-bridge/src-tauri/src/main.rs",
    "supabase/tests/example.sql",
    "CONTEXT.md",
    "LICENSE",
  ]) {
    assert.equal(isDeploymentNeutralPath(path), true, path);
  }
  assert.equal(shouldIgnoreDeployment(["docs/README.md", "tests/example.test.mjs"]), true);
});

test("runtime and build-system changes always trigger a Vercel build", () => {
  for (const path of [
    "app/api/studio/automix/route.ts",
    "lib/media-worker/sandbox.ts",
    "services/media-worker/app/automix.py",
    "scripts/build-studio-css.mjs",
    "package.json",
    "package-lock.json",
    "next.config.mjs",
    "vercel.json",
  ]) {
    assert.equal(isDeploymentNeutralPath(path), false, path);
    assert.equal(shouldIgnoreDeployment(["docs/README.md", path]), false, path);
  }
});

test("vercel.json delegates ignored-build decisions to the conservative script", () => {
  const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  assert.equal(config.ignoreCommand, "node scripts/vercel-ignore-build.mjs");
});
