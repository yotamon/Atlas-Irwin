import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("normalized DJ library contract stays source neutral and versioned", async () => {
  const contract = await source("lib/automix/source-contract.ts");
  const schema = JSON.parse(await source("contracts/dj-library-source.v1.json"));

  assert.ok(contract.includes('DJ_LIBRARY_CONTRACT_VERSION = "ensemblis.dj-library-source.v1"'));
  assert.ok(contract.includes("export type NormalizedDjLibraryTrack"));
  assert.ok(contract.includes("analysisProvenance"));
  assert.ok(contract.includes("trackIntelligenceFingerprint"));
  assert.ok(contract.includes("playlistIds"));
  assert.ok(contract.includes("cuePoints"));
  assert.ok(contract.includes("beatGrid"));
  assert.equal(schema.properties.version.const, "ensemblis.dj-library-source.v1");
  assert.deepEqual(schema.properties.source.properties.kind.enum, [
    "artist_catalog", "local_library", "rekordbox", "serato", "traktor",
  ]);
});

test("source adapter exposes the full roadmap lifecycle without planner-specific methods", async () => {
  const contract = await source("lib/automix/source-contract.ts");

  for (const method of [
    "detect(context:",
    "describeSource(context:",
    "scanTracks(context:",
    "scanPlaylists(context:",
    "readTrackMetadata(context:",
    "readCuePoints(context:",
    "readBeatGrid(context:",
    "readPlayHistory(context:",
    "getRevision(context:",
  ]) assert.ok(contract.includes(method), `missing adapter method ${method}`);

  assert.equal(contract.includes("orderSet("), false);
  assert.equal(contract.includes("planTransition("), false);
});

test("execution adapters resolve media without leaking device concerns into the planner", async () => {
  const execution = await source("lib/automix/execution-adapter.ts");

  assert.ok(execution.includes('AUTOMIX_EXECUTION_CONTRACT_VERSION = "ensemblis.automix-execution-adapter.v1"'));
  assert.ok(execution.includes("export interface AutoMixExecutionAdapter"));
  assert.ok(execution.includes("class CloudCatalogExecutionAdapter"));
  assert.ok(execution.includes("resolveSources(request:"));
  assert.ok(execution.includes('target: "cloud"'));
  assert.ok(execution.includes('supportedSourceKinds: ["artist_catalog"]'));
});

test("source registry detects and scans adapters through one normalized boundary", async () => {
  const registry = await source("lib/automix/source-registry.ts");

  assert.ok(registry.includes("class DjLibrarySourceRegistry"));
  assert.ok(registry.includes("detectAll(context:"));
  assert.ok(registry.includes("scan(kind:"));
  assert.ok(registry.includes("describeAvailableSources(context:"));
});
