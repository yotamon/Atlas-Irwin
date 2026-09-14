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
  assert.doesNotMatch(source, /TrackAnalysisProgress/);
  assert.doesNotMatch(source, /progress=\{/);
  assert.doesNotMatch(source, /role="progressbar"/);
});

test("track header only exposes stable source and verified intelligence facts", async () => {
  const source = await readFile(trackPagePath, "utf8");

  assert.match(source, /Master attached/);
  assert.match(source, /Master required/);
  assert.match(source, /analysis\.hasMusicMap \? \[/);
  assert.doesNotMatch(source, /const intelligenceFact/);
  assert.doesNotMatch(source, /\{ label: "Intelligence", value:/);
  assert.doesNotMatch(source, /\{ label: "Master", value:/);
});

test("active analysis is automatic and recovery remains explicit", async () => {
  const source = await readFile(trackPagePath, "utf8");

  assert.match(source, /AnalysisAutoRefresh active=\{analysis\.isActive\}/);
  assert.match(source, /analysisNeedsRecovery\s*\? <Link className="button primary" href="#analysis-recovery">Retry intelligence<\/Link>/);
  assert.match(source, /analysis\.isActive \? \(/);
  assert.match(source, /Normal ingestion is automatic/);
  assert.match(source, /Start a fresh Track Intelligence pass here only when you intentionally want to refresh or repair the current result/);
  assert.match(source, /The canonical master and any verified results remain untouched until a new full result succeeds/);
});
