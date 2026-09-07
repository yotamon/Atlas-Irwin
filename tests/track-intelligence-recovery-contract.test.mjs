import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Track Intelligence has one shared partial, active, retry and diagnostics model", async () => {
  const state = await readFile("lib/studio/track-analysis-state.ts", "utf8");
  const releasePanel = await readFile("components/studio/release-master-audio-panel.tsx", "utf8");
  const trackPage = await readFile("app/studio/(protected)/music/[id]/page.tsx", "utf8");
  const submitButton = await readFile("components/studio/analysis-submit-button.tsx", "utf8");

  assert.ok(state.includes('"pending", "queued", "dispatched", "running"'));
  assert.ok(state.includes('label = "Partial intelligence"'));
  assert.ok(state.includes('actionLabel = "Retry full analysis"'));
  assert.ok(state.includes("will not use a paid fallback"));

  assert.ok(releasePanel.includes("describeTrackAnalysis"));
  assert.ok(releasePanel.includes("Verified results are still available."));
  assert.ok(releasePanel.includes("Technical diagnostics"));
  assert.ok(releasePanel.includes("AnalysisSubmitButton"));

  assert.ok(trackPage.includes("describeTrackAnalysis"));
  assert.ok(trackPage.includes("AnalysisAutoRefresh"));
  assert.ok(trackPage.includes("Analysis recovery"));
  assert.ok(trackPage.includes("AnalysisSubmitButton"));

  assert.ok(submitButton.includes("useFormStatus"));
  assert.ok(submitButton.includes("disabled={pending}"));
});

test("analysis dispatch does not create duplicate active jobs and preserves retry lineage", async () => {
  const actions = await readFile("app/studio/growth-media-actions.ts", "utf8");

  assert.ok(actions.includes('new Set(["queued", "dispatched", "running"])'));
  assert.ok(actions.includes("alreadyActive: true"));
  assert.ok(actions.includes("previous_attempt: previous"));
  assert.ok(actions.includes("music_intelligence_version: 4"));
  assert.ok(actions.includes("will not use a paid fallback"));
});

test("analysis auto refresh stays alive for multi-minute deep audio passes without aggressive polling", async () => {
  const refresh = await readFile("components/studio/analysis-auto-refresh.tsx", "utf8");

  assert.ok(refresh.includes("refreshes < 24 ? 5000 : 10000"));
  assert.ok(refresh.includes("refreshes < 72"));
  assert.ok(refresh.includes("window.setTimeout"));
  assert.ok(!refresh.includes("window.setInterval"));
});
