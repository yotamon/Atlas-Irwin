import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("deep main CI installs and compiles every Active Mastering and AutoMix runtime dependency", async () => {
  const ci = await readFile(".github/workflows/ci.yml", "utf8");
  const audioCi = await readFile(".github/workflows/audio-intelligence-ci.yml", "utf8");
  const requirements = await readFile("services/media-worker/requirements.txt", "utf8");

  assert.ok(requirements.includes("httpx==0.28.1"));
  assert.ok(requirements.includes("pydantic==2.11.7"));
  assert.ok(requirements.includes("python-stretch==0.3.1"));
  assert.ok(ci.includes("services/media-worker/app/mastering_processor.py"));
  assert.ok(ci.includes("services/media-worker/app/automix_intelligence.py"));
  assert.ok(ci.includes("services/media-worker/app/automix_dsp.py"));
  assert.ok(ci.includes("numpy librosa soundfile pyloudnorm imageio-ffmpeg httpx pydantic python-stretch"));
  assert.ok(audioCi.includes("services/media-worker/app/automix_intelligence.py"));
  assert.ok(audioCi.includes("python-stretch==0.3.1"));
});

test("deep audio regressions install benchmark-only dependencies without bloating production runtime", async () => {
  const ci = await readFile(".github/workflows/ci.yml", "utf8");
  const benchmark = await readFile("services/media-worker/requirements-audio-benchmark.txt", "utf8");
  const production = await readFile("services/media-worker/requirements.txt", "utf8");
  const sandbox = await readFile("lib/media-worker/sandbox.ts", "utf8");

  assert.ok(benchmark.includes("mir-eval==0.8.2"));
  assert.ok(benchmark.includes("audiomentations==0.43.1"));
  assert.ok(ci.includes("-r services/media-worker/requirements-audio-benchmark.txt"));
  assert.ok(ci.includes("Run Track Intelligence behavioral regression tests"));

  assert.ok(!production.includes("mir-eval"));
  assert.ok(!production.includes("audiomentations"));
  assert.ok(!sandbox.includes("requirements-audio-benchmark.txt"));
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
