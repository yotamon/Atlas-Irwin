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
