import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const trackPagePath = "app/studio/(protected)/music/[id]/page.tsx";

test("track workspace reuses canonical Ensemblis processing language", async () => {
  const source = await readFile(trackPagePath, "utf8");

  assert.match(source, /ProcessingState/);
  assert.match(source, /stage: "analyzing" as const/);
  assert.match(source, /stage: "preparing" as const/);
  assert.doesNotMatch(source, /TrackAnalysisProgress/);
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
  assert.match(source, /You do not need to start or babysit anything/);
  assert.match(source, /canonical master and any verified results remain untouched/);
});
