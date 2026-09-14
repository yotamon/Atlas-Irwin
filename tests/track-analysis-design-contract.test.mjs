import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const trackPagePath = "app/studio/(protected)/music/[id]/page.tsx";

test("track workspace reuses canonical Ensemblis processing language", async () => {
  const source = await readFile(trackPagePath, "utf8");

  assert.match(source, /ProcessingState/);
  assert.match(source, /Track Intelligence · Listening/);
  assert.match(source, /Listening to master/);
  assert.match(source, /Analysis queued/);
  assert.match(source, /Music Intelligence · Context/);
  assert.match(source, /Ensemblis is finishing the release context/);
  assert.match(source, /progress=\{ingestion\.progress\}/);
  assert.doesNotMatch(source, /TrackAnalysisProgress/);
  assert.doesNotMatch(source, /role="progressbar"/);
});

test("track header derives status from shared ingestion while verified facts stay stable", async () => {
  const source = await readFile(trackPagePath, "utf8");

  assert.ok(source.includes('subtitle={`${duration(vaultTrack.duration_seconds)} · ${ingestion.label}`}'));
  assert.match(source, /analysis\.hasMusicMap \? \[/);
  assert.match(source, /\{ label: "Structure", value:/);
  assert.match(source, /\{ label: "Strong moments", value:/);
  assert.doesNotMatch(source, /const intelligenceFact/);
  assert.doesNotMatch(source, /\{ label: "Intelligence", value:/);
  assert.doesNotMatch(source, /\{ label: "Master", value:/);
});

test("active ingestion is automatic and recovery remains explicit", async () => {
  const source = await readFile(trackPagePath, "utf8");

  assert.ok(source.includes("<AnalysisAutoRefresh active={analysis.isActive || ingestionActive} />"));
  assert.match(source, /analysisNeedsRecovery\s*\? <Link className="button primary" href="#analysis-recovery">Retry intelligence<\/Link>/);
  assert.ok(source.includes("analysis.isActive || ingestionActive ? ("));
  assert.match(source, /Normal ingestion is automatic/);
  assert.match(source, /Start a fresh Track Intelligence pass here only when you intentionally want to refresh or repair the current result/);
  assert.match(source, /The canonical master and any verified results remain untouched until a new full result succeeds/);
});
