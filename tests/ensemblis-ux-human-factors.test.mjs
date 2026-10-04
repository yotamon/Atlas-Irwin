import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared action hierarchy enforces one dominant action and bounded secondary choices", async () => {
  const widgets = await source("components/studio/ux-v4-widgets.tsx");

  assert.match(widgets, /MAX_VISIBLE_SECONDARY_ACTIONS\s*=\s*2/);
  assert.match(widgets, /primaryActions\.length\s*>\s*1/);
  assert.match(widgets, /only one primary action/i);
});

test("Track default surface exposes state and ranked recommendation before technical detail", async () => {
  const track = await source("app/studio/(protected)/music/[id]/page.tsx");

  const state = track.indexOf("track-human-factors-state");
  const recommendation = track.indexOf("track-human-factors-recommendation");
  const actions = track.indexOf("track-human-factors-actions");
  const summary = track.indexOf("track-human-factors-summary");
  const technical = track.indexOf("Technical details");

  assert.ok(state >= 0, "Track needs one explicit current-state surface");
  assert.ok(recommendation > state, "ranked recommendation must follow current state");
  assert.ok(actions > recommendation, "secondary object actions must follow the recommendation");
  assert.ok(summary > actions, "music understanding summary must follow task actions");
  assert.ok(technical > summary, "technical detail must stay secondary");
});

test("advanced evidence uses the existing contextual disclosure system", async () => {
  const track = await source("app/studio/(protected)/music/[id]/page.tsx");
  const widgets = await source("components/studio/ux-v4-widgets.tsx");
  const inspector = await source("components/studio/context-inspector.tsx");

  assert.ok(track.includes("<ContextInspector"));
  assert.ok(widgets.includes("export function CompactEvidence"));
  assert.ok(inspector.includes('aria-haspopup="dialog"'));
});


test("Mastering derives one visible stage from canonical readiness and job state", async () => {
  const controls = await source("components/studio/active-mastering-controls.tsx");

  assert.match(controls, /export type MasteringStage = "source" \| "recommendation" \| "processing" \| "review" \| "result"/);
  assert.match(controls, /export function resolveMasteringStage/);
  assert.match(controls, /data-mastering-stage=\{masteringStage\}/);
  assert.match(controls, /masteringStage === "source"/);
  assert.match(controls, /masteringStage === "processing"/);
  assert.match(controls, /masteringStage === "recommendation"/);
  assert.match(controls, /masteringStage === "review"/);
  assert.match(controls, /masteringStage === "result"/);
  assert.match(controls, /visibleCandidates/);
});

test("Mastering review owns A B listening and final artist decision", async () => {
  const controls = await source("components/studio/active-mastering-controls.tsx");

  const reviewBranch = controls.indexOf('masteringStage === "review"');
  const listenLab = controls.indexOf("<MasteringListenLab", reviewBranch);
  const keepOriginal = controls.indexOf("Keep original", reviewBranch);
  const approve = controls.indexOf("Use as canonical master", reviewBranch);
  assert.ok(reviewBranch >= 0);
  assert.ok(listenLab > reviewBranch);
  assert.ok(keepOriginal > listenLab);
  assert.ok(approve > keepOriginal);
});


test("Grow default surface is recommendation then progress then compact context", async () => {
  const grow = await source("app/studio/(protected)/growth/page.tsx");

  const recommendation = grow.indexOf("growth-human-factors-recommendation");
  const progress = grow.indexOf("growth-human-factors-progress");
  const context = grow.indexOf("growth-human-factors-context");
  assert.ok(recommendation >= 0);
  assert.ok(progress > recommendation);
  assert.ok(context > progress);
  assert.match(grow, /growth-human-factors-calm/);
});

test("Grow keeps opportunity review and detailed evidence out of the overview task stack", async () => {
  const grow = await source("app/studio/(protected)/growth/page.tsx");

  assert.match(grow, /view === "opportunities"/);
  assert.match(grow, /CompactEvidence/);
  assert.doesNotMatch(grow, /growth-v5-overview[\s\S]*growth-opportunity-grid[\s\S]*growth-human-factors-progress/);
});


test("Release overview has one lifecycle recommendation before blockers and readiness", async () => {
  const release = await source("components/studio/release-workspace-v2.tsx");
  const recommendation = release.indexOf("release-human-factors-recommendation");
  const blockers = release.indexOf("release-human-factors-blockers");
  const readiness = release.indexOf("release-human-factors-readiness");
  assert.ok(recommendation >= 0);
  assert.ok(blockers > recommendation);
  assert.ok(readiness > blockers);
  assert.match(release, /release-human-factors-details/);
});

test("Release header orients without competing with the lifecycle recommendation", async () => {
  const release = await source("components/studio/release-workspace-v2.tsx");
  const headerStart = release.indexOf("<ObjectHeader");
  const headerEnd = release.indexOf("/>", headerStart);
  const header = release.slice(headerStart, headerEnd);
  assert.doesNotMatch(header, /actions=/);
  assert.match(release, /release-human-factors-recommendation/);
  assert.match(release, /ReleaseTracklist/);
  assert.match(release, /ReleaseMasteringCoherence/);
});


test("AutoMix render recovery belongs to the render stage instead of the global workflow", async () => {
  const workflow = await source("components/studio/automix-workflow.tsx");
  const catalog = await source("components/studio/set-builder-workspace.tsx");
  const local = await source("components/studio/local-set-builder-workspace.tsx");

  assert.doesNotMatch(workflow, /<AutoMixRenderRecovery/);
  for (const builder of [catalog, local]) {
    const renderStage = builder.lastIndexOf('workflowStage === "render"');
    const recovery = builder.indexOf("<AutoMixRenderRecovery", renderStage);
    assert.ok(renderStage >= 0);
    assert.ok(recovery > renderStage, "render recovery must live inside the render-stage branch");
  }
});

test("AutoMix keeps specialist DJ machinery behind one advanced disclosure", async () => {
  const workflow = await source("components/studio/automix-workflow.tsx");
  const disclosure = workflow.indexOf("en-automix-advanced");
  for (const panel of ["<DjIntelligencePanel", "<LibraryBridgePanel", "<RekordboxImportPanel"]) {
    assert.ok(workflow.indexOf(panel) > disclosure);
  }
});
