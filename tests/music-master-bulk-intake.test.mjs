import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function runtime(path) {
  const input = await source(path);
  const compiled = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const runtimeModule = { exports: {} };
  new Function("module", "exports", compiled)(runtimeModule, runtimeModule.exports);
  return runtimeModule.exports;
}

test("master filename versions are distinct from song titles", async () => {
  const { musicFilenameIdentity: parse } = await runtime("lib/studio/music-filename-identity.ts");
  assert.deepEqual(parse("Disco Fever (Remastered x2).wav"), { title: "Disco Fever", version: "Remastered x2" });
  assert.deepEqual(parse("Going Sane (Remastered).WAV"), { title: "Going Sane", version: "Remastered" });
  assert.deepEqual(parse("Closer Tonight (Remaster).flac"), { title: "Closer Tonight", version: "Remaster" });
  assert.deepEqual(parse("Mix Name (v2).aiff"), { title: "Mix Name", version: "v2" });
  assert.deepEqual(parse("The Unspoken.wav (1)"), { title: "The Unspoken", version: null });
});

test("creative parentheticals, artist credits and unknown suffixes remain titles", async () => {
  const { musicFilenameIdentity: parse } = await runtime("lib/studio/music-filename-identity.ts");
  assert.deepEqual(parse("Love Like This.wav"), { title: "Love Like This", version: null });
  assert.deepEqual(parse("Never Stop (feat. Jane).wav"), { title: "Never Stop (feat. Jane)", version: null });
  assert.deepEqual(parse("Can't Stop (Watching).wav"), { title: "Can't Stop (Watching)", version: null });
  assert.deepEqual(parse("Secret Places (Live).wav"), { title: "Secret Places (Live)", version: null });
  assert.deepEqual(parse("  .wav"), { title: "Untitled master", version: null });
});

test("untyped WAV downloads are accepted without changing their audio bytes", async () => {
  const { normalizeAudioMime } = await runtime("lib/studio/music-upload-file.ts");
  const original = new File([Uint8Array.from([1, 2, 0, 255])], "Soft Touch.WAV", { lastModified: 42 });
  const normalized = normalizeAudioMime(original);
  assert.equal(normalized.type, "audio/wav");
  assert.equal(normalized.size, original.size);
  assert.equal(normalized.lastModified, original.lastModified);
  assert.deepEqual(Array.from(new Uint8Array(await normalized.arrayBuffer())), [1, 2, 0, 255]);
  const octet = new File(["audio"], "Going Sane.flac", { type: "application/octet-stream" });
  assert.equal(normalizeAudioMime(octet).type, "audio/flac");
});

test("non-audio MIME and unknown extensions are never silently reinterpreted", async () => {
  const { normalizeAudioMime } = await runtime("lib/studio/music-upload-file.ts");
  const pdf = new File(["not audio"], "Track.wav", { type: "application/pdf" });
  assert.strictEqual(normalizeAudioMime(pdf), pdf);
  const unknown = new File(["raw"], "Track.bin");
  assert.strictEqual(normalizeAudioMime(unknown), unknown);
  const typed = new File(["audio"], "Track.wav", { type: "audio/x-wav" });
  assert.strictEqual(normalizeAudioMime(typed), typed);
});

test("bulk upload title/version stays authoritative on the server and selection dedupes", async () => {
  const [action, uploader] = await Promise.all([
    source("app/studio/growth-media-actions.ts"),
    source("components/studio/media-uploader.tsx"),
  ]);
  assert.match(action, /musicFilenameIdentity\(originalName\)/);
  assert.match(action, /version: identity\.version/);
  assert.match(action, /requestedTitle \|\| identity\.title/);
  assert.match(action, /\.eq\("artist_id", artist\.artistId\)/);
  assert.match(uploader, /const source = Array\.from\(files\)\.map\(\(file\) => audioOnly \? normalizeAudioMime\(file\) : file\)/);
  assert.match(uploader, /signatures\.add\(signature\)/);
  assert.match(uploader, /vaultForm\.set\("title", items\.length === 1 \? title\.trim\(\) : ""\)/);
  assert.match(uploader, /musicFilenameIdentity\(items\[0\]\.file\.name\)\.title/);
});
