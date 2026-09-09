import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const EXPECTED_JOB_TYPES = [
  "analyze_audio",
  "analyze_stem",
  "extract_frame",
  "render_master",
  "render_social",
  "render_promo",
  "render_hook",
  "render_audio_scene",
  "master_audio",
  "finish_social_video",
  "render_automix",
];

test("Media Worker contract v1 stays aligned across JSON, TypeScript dispatch, Sandbox and Python runner", async () => {
  const [contractText, typescript, dispatcher, sandbox, runner] = await Promise.all([
    read("contracts/media-worker.v1.json"),
    read("lib/media-worker/contract.ts"),
    read("lib/media-worker/dispatcher.ts"),
    read("lib/media-worker/sandbox.ts"),
    read("services/media-worker/app/runner.py"),
  ]);
  const contract = JSON.parse(contractText);

  assert.equal(contract.version, 1);
  assert.equal(contract.payloadVersionKey, "__ensemblis_media_worker_contract_version");
  assert.deepEqual(contract.jobTypes, EXPECTED_JOB_TYPES);

  assert.match(typescript, /MEDIA_WORKER_CONTRACT_VERSION = 1/);
  assert.match(typescript, /__ensemblis_media_worker_contract_version/);
  assert.match(dispatcher, /withMediaWorkerContractVersion/);
  assert.match(runner, /CONTRACT_VERSION = 1/);
  assert.match(runner, /__ensemblis_media_worker_contract_version/);
  assert.match(runner, /validate_request_envelope\(payload\)/);

  for (const jobType of EXPECTED_JOB_TYPES) {
    assert.ok(typescript.includes(`"${jobType}"`), `TypeScript contract missing ${jobType}`);
    assert.ok(sandbox.includes(`"${jobType}"`), `Sandbox dispatcher missing ${jobType}`);
    assert.ok(runner.includes(`"${jobType}"`), `Python runner contract missing ${jobType}`);
  }
});
