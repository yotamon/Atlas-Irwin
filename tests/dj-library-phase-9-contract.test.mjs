import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Traktor NML adapter stays provider neutral, versioned and size bounded", async () => {
  const adapter = await source("lib/dj-library/traktor-nml.ts");

  assert.ok(adapter.includes('TRAKTOR_NML_ADAPTER_VERSION = "ensemblis.traktor-nml.v1"'));
  assert.ok(adapter.includes("implements DjLibrarySourceAdapter<TraktorNmlContext>"));
  assert.ok(adapter.includes("export function traktorNmlRevision(nml: string)"));
  assert.ok(adapter.includes("export function parseTraktorNml(context: TraktorNmlContext)"));
  assert.ok(adapter.includes("export function exportTraktorM3u(input: TraktorM3uExportInput)"));
  assert.ok(adapter.includes("sourceStableTrackId"));
  assert.match(adapter, /MAX_NML_BYTES = \d+ \* 1024 \* 1024;/);
  assert.match(adapter, /exceeds the 64 MiB import safety limit/);
  assert.equal(adapter.includes("orderSet("), false);
  assert.equal(adapter.includes("planTransition("), false);
});

test("hybrid candidate snapshots are versioned and normalize fail closed", async () => {
  const candidates = await source("lib/automix/hybrid-candidates.ts");

  assert.ok(
    candidates.includes(
      'AUTOMIX_HYBRID_CANDIDATE_SNAPSHOT_VERSION = "ensemblis.automix-hybrid-candidates.v1"',
    ),
  );
  assert.ok(candidates.includes("export function normalizeHybridCandidateSnapshot"));
  assert.match(candidates, /raw\.version !== AUTOMIX_HYBRID_CANDIDATE_SNAPSHOT_VERSION/);
  assert.ok(candidates.includes('executionTarget: "hybrid_device"'));
  assert.match(candidates, /return null;/);
  assert.match(candidates, /candidate\.deviceId !== deviceId/);
});

test("hybrid execution adapter spans cloud and device on one execution contract", async () => {
  const execution = await source("lib/automix/execution-adapter.ts");

  assert.ok(execution.includes("class HybridDeviceExecutionAdapter"));
  assert.ok(execution.includes("verifyDeviceSource(source: AutoMixSourceTrackRef)"));
  assert.ok(execution.includes('target: "cloud"'));
  assert.ok(execution.includes('target: "device"'));
  assert.match(execution, /HybridDeviceExecutionAdapter cannot execute this manifest\./);
  assert.ok(execution.includes("AUTOMIX_EXECUTION_CONTRACT_VERSION"));
});

test("hybrid plan route stays admin scoped, artist scoped and frozen-plan bound", async () => {
  const route = await source("app/api/studio/automix/hybrid-plans/route.ts");

  assert.ok(route.includes("requireStudioAdmin"));
  assert.ok(route.includes("resolveArtistContext"));
  assert.ok(route.includes('MIXPLAN_VERSION = "ensemblis.mixplan.v2"'));
  assert.ok(route.includes('HYBRID_RENDER_JOB_VERSION = "ensemblis.library-bridge.render-job.v2"'));
  assert.ok(route.includes("assertHybridDeviceSourcesStillAvailable"));
  assert.ok(route.includes("assertPathFree"));
});

test("planner code consumes device sources through the trust boundary, never vendor adapters", async () => {
  const candidates = await source("lib/automix/hybrid-candidates.ts");

  assert.ok(candidates.includes('from "@/lib/dj-library/device-server"'));
  assert.equal(candidates.includes("traktor-nml"), false);
});
