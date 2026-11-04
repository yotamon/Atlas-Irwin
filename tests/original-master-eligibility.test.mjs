import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function eligibilityFn() {
  const compiled = ts.transpileModule(await read("lib/studio/original-master-eligibility.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const runtimeModule = { exports: {} };
  new Function("module", "exports", compiled)(runtimeModule, runtimeModule.exports);
  return runtimeModule.exports.originalMasterEligibility;
}

const correct = {
  artistId: "artist-a",
  assetType: "master_audio",
  mimeType: "audio/wav",
  metadata: { tags: ["artist:artist-a", "unreleased", "music"], upload_source: "release_workspace" },
};

test("source-first admission accepts only explicitly artist-scoped original mastered recordings", async () => {
  const check = await eligibilityFn();
  assert.equal(check(correct).allowed, true);
  assert.equal(check({ ...correct, metadata: { tags: ["ARTIST:ARTIST-A", "music"] } }).allowed, true);
});

test("rejects another artist's files and untagged legacy assets", async () => {
  const check = await eligibilityFn();
  for (const metadata of [{ tags: ["artist:artist-b"] }, { tags: ["music"] }, {}, null]) {
    const state = check({ ...correct, metadata });
    assert.equal(state.allowed, false);
    assert.match(state.reason, /active artist/);
  }
});

test("generated mastering outputs and automixes cannot be imported as new canonical source tracks", async () => {
  const check = await eligibilityFn();
  for (const marker of ["active-mastering", "automix", "dj-mix", "mastering-reference", "mastering-preview"]) {
    const status = check({ ...correct, metadata: { tags: ["artist:artist-a", marker] } });
    assert.equal(status.allowed, false);
    assert.match(status.reason, /derivative/);
  }
  assert.equal(check({
    ...correct,
    metadata: { tags: ["artist:artist-a"], upload_source: "active-mastering" },
  }).allowed, false);
});

test("audio previews or stems cannot masquerade as mastered songs", async () => {
  const check = await eligibilityFn();
  assert.equal(check({ ...correct, assetType: "stem" }).allowed, false);
  assert.equal(check({ ...correct, assetType: "audio_preview" }).allowed, false);
  assert.equal(check({ ...correct, mimeType: "image/png" }).allowed, false);
});

test("Vault action checks source eligibility before inserting a new track and retains idempotent reuse", async () => {
  const action = await read("app/studio/growth-media-actions.ts");
  const start = action.indexOf("export async function createVaultTrackFromMedia");
  const end = action.indexOf("export async function attachReleaseMasterFromMedia");
  const body = action.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(body, /originalMasterEligibility\(/);
  assert.match(body, /\.eq\("owner_id", user\.id\)/);
  assert.match(body, /if \(existing\) return \{ id: existing\.id, deduplicated: true \};/);
  assert.ok(body.indexOf("originalMasterEligibility(") < body.indexOf('growth.from("track_vault").insert('));
  assert.match(body, /artistId: artist\.artistId/);
});
