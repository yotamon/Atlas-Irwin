import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("deep main CI installs and compiles every Active Mastering runtime dependency", async () => {
  const ci = await readFile(".github/workflows/ci.yml", "utf8");
  const requirements = await readFile("services/media-worker/requirements.txt", "utf8");

  assert.ok(requirements.includes("httpx==0.28.1"));
  assert.ok(requirements.includes("pydantic==2.11.7"));
  assert.ok(ci.includes("services/media-worker/app/mastering_processor.py"));
  assert.ok(ci.includes("numpy librosa soundfile pyloudnorm imageio-ffmpeg httpx pydantic"));
});

test("Vercel Sandbox bootstrap ships every module imported by the production runner", async () => {
  const sandbox = await readFile("lib/media-worker/sandbox.ts", "utf8");
  const runner = await readFile("services/media-worker/app/runner.py", "utf8");

  assert.ok(runner.includes("from .music_intelligence_v4_runtime import analyze_music as analyze_music_v4"));
  assert.ok(runner.includes("from .mastering_processor import MasteringWorkerRequest, execute_mastering"));
  assert.ok(runner.includes("from .stem_intelligence_v3 import analyze_stem as analyze_stem_v3"));

  assert.ok(sandbox.includes('"app/music_intelligence_v4_runtime.py"'));
  assert.ok(sandbox.includes('"app/mastering_processor.py"'));
  assert.ok(sandbox.includes('"app/stem_intelligence_v3.py"'));
  assert.ok(sandbox.includes('"app/runner.py"'));
  assert.ok(sandbox.includes("Atlas did not use a paid fallback"));
});
