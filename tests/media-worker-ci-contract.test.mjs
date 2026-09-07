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
