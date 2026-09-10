import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("AutoMix terminal callback registers a valid master audio asset", async () => {
  const callback = await readFile("app/api/studio/automix/callback/route.ts", "utf8");
  assert.ok(callback.includes('asset_type: "master_audio"'));
  assert.equal(callback.includes('asset_type: "audio_master"'), false);
});
