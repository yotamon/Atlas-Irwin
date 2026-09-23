import test from "node:test";
import assert from "node:assert/strict";
import { isDeploymentNeutralPath, shouldIgnoreDeployment } from "../scripts/vercel-ignore-build.mjs";

test("deployment-neutral engineering files skip Vercel", () => {
  for (const path of [
    "docs/architecture/local-first.md",
    "tests/music-intelligence.test.mjs",
    "e2e/studio.spec.ts",
    "apps/library-bridge/src-tauri/src/main.rs",
    "services/media-worker/tests/test_automix.py",
    "services/media-worker/benchmarks/evaluate_mir.py",
    "services/media-worker/requirements-audio-benchmark.txt",
    "supabase/migrations/202609150001_example.sql",
    ".env.example",
    ".github/workflows/library-bridge-release.yml",
  ]) {
    assert.equal(isDeploymentNeutralPath(path), true, path);
  }
});

test("runtime application and worker changes still build", () => {
  for (const path of [
    "app/api/runtime/models/route.ts",
    "components/studio/library-bridge-panel.tsx",
    "lib/media-worker/queue.ts",
    "services/media-worker/app/runner.py",
    "package-lock.json",
    "scripts/vercel-ignore-build.mjs",
  ]) {
    assert.equal(isDeploymentNeutralPath(path), false, path);
  }
});

test("mixed runtime commits build and empty diffs fail open", () => {
  assert.equal(shouldIgnoreDeployment(["docs/README.md", "tests/foo.test.mjs"]), true);
  assert.equal(shouldIgnoreDeployment(["docs/README.md", "app/page.tsx"]), false);
  assert.equal(shouldIgnoreDeployment([]), false);
});
