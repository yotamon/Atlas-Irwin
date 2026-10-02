import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function intentModule() {
  const source = await readFile(new URL("../lib/studio/intent/domain.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

test("common artist goals resolve deterministically before semantic fallback", async () => {
  const { classifyStudioIntent } = await intentModule();

  assert.deepEqual(
    classifyStudioIntent("add music"),
    {
      kind: "add_music",
      objectType: "any",
      objectQuery: "",
      desiredOutcome: null,
      confidence: "high",
      source: "deterministic",
    },
  );

  const master = classifyStudioIntent("master Love Like This");
  assert.equal(master.kind, "master_track");
  assert.equal(master.objectType, "track");
  assert.equal(master.objectQuery, "Love Like This");

  const create = classifyStudioIntent("make a reel from Love Like This");
  assert.equal(create.kind, "create_from_object");
  assert.equal(create.objectType, "track");
  assert.equal(create.objectQuery, "Love Like This");
  assert.equal(create.desiredOutcome, "reel");

  const readiness = classifyStudioIntent("is Funkable ready to release?");
  assert.equal(readiness.kind, "release_readiness");
  assert.equal(readiness.objectType, "release");
  assert.equal(readiness.objectQuery, "Funkable");

  const results = classifyStudioIntent("how is Dancing In Color doing?");
  assert.equal(results.kind, "release_results");
  assert.equal(results.objectType, "release");
  assert.equal(results.objectQuery, "Dancing In Color");

  const priority = classifyStudioIntent("what should I work on today?");
  assert.equal(priority.kind, "today_priority");
  assert.equal(priority.objectQuery, "");

  const latestReel = classifyStudioIntent("make a reel from my latest track");
  assert.equal(latestReel.kind, "create_from_object");
  assert.equal(latestReel.objectType, "track");
  assert.equal(latestReel.objectQuery, "");
  assert.equal(latestReel.desiredOutcome, "reel");

  const latestPromotion = classifyStudioIntent("promote my latest release");
  assert.equal(latestPromotion.kind, "promote_release");
  assert.equal(latestPromotion.objectQuery, "");

  const latestMix = classifyStudioIntent("make a DJ mix from my latest track");
  assert.equal(latestMix.kind, "mix_music");
  assert.equal(latestMix.objectType, "track");
  assert.equal(latestMix.objectQuery, "");
});

test("continuation and connection intents stay bounded and explicit", async () => {
  const { classifyStudioIntent } = await intentModule();

  const resume = classifyStudioIntent("continue my mix");
  assert.equal(resume.kind, "continue_work");
  assert.equal(resume.objectType, "mix");

  const connect = classifyStudioIntent("connect Rekordbox");
  assert.equal(connect.kind, "connect_library");
  assert.equal(connect.objectQuery, "");

  const fallback = classifyStudioIntent("Love Like This");
  assert.equal(fallback.kind, "open_object");
  assert.equal(fallback.objectType, "any");
  assert.equal(fallback.confidence, "low");
});
