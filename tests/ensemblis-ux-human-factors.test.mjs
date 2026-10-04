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


test("Today renders one ranked primary task instead of equal Continue and Priority blocks", async () => {
  const today = await source("app/studio/(protected)/page.tsx");

  assert.match(today, /const primaryTodayTask/);
  assert.match(today, /today-human-factors-primary/);
  assert.match(today, /today-human-factors-secondary/);
  assert.match(today, /primaryTodayTask\.kind === "continue"/);
  assert.match(today, /primaryTodayTask\.kind === "priority"/);
});

test("Add Music is consequence-first and moves product philosophy behind disclosure", async () => {
  const music = await source("app/studio/(protected)/music/page.tsx");

  assert.match(music, /Add the music Ensemblis should work from\./);
  assert.match(music, /How Ensemblis uses your source/);
  assert.doesNotMatch(music, /Ensemblis principle/);
  assert.doesNotMatch(music, /The song comes before the marketing workflow\./);
});

test("Create distinguishes the recommended direction from alternatives", async () => {
  const create = await source("app/studio/(protected)/create/page.tsx");

  assert.match(create, /isPrimaryDirection/);
  assert.match(create, /is-primary-recommendation/);
  assert.match(create, /is-alternative/);
  assert.match(create, /className=\{isPrimaryDirection \? "button primary" : "button"\}/);
});


test("mobile keeps contextual detail in a full-height sheet with focus return", async () => {
  const inspector = await source("components/studio/context-inspector.tsx");
  const dialog = await source("components/studio/dialog.tsx");
  const overlays = await source("app/studio/design-system/overlays.css");

  assert.match(inspector, /className="ensemblis-context-inspector"/);
  assert.match(inspector, /returnFocusRef={triggerRef}/);
  assert.match(dialog, /finalFocus={returnFocusRef}/);
  assert.match(overlays, /@media \(max-width: 680px\)[\s\S]*\.ensemblis-dialog\.ensemblis-context-inspector\s*\{[\s\S]*height:\s*calc\(100svh - 1rem\)/);
  assert.match(overlays, /\.ensemblis-dialog\.ensemblis-context-inspector \.ensemblis-dialog-body\s*\{[^}]*flex:\s*1/s);
});

test("mobile keeps the primary task action reachable and workflow progress compact", async () => {
  const workflows = await source("app/studio/design-system/workflows.css");
  const accessibility = await source("app/studio/design-system/accessibility.css");

  assert.match(workflows, /@media \(max-width: 760px\)[\s\S]*\.en-next-action-widget \.actions \.button\.primary[^\{]*\{[^}]*width:\s*100%/s);
  assert.match(workflows, /\.en-workflow-stepper\s*\{[^}]*scroll-snap-type:\s*x proximity/s);
  assert.match(workflows, /\.en-workflow-stepper button\s*\{[^}]*scroll-snap-align:\s*start/s);
  assert.match(accessibility, /@media \(pointer: coarse\)[\s\S]*min-height:\s*var\(--en-control-lg\)/);
  assert.match(accessibility, /@media \(prefers-reduced-motion: reduce\)/);
});


test("friction telemetry stays categorical and covers the recovery signals", async () => {
  const client = await source("lib/studio/ux-telemetry-client.ts");
  const telemetry = await source("components/studio/ux-telemetry.tsx");
  const endpoint = await source("app/api/studio/ux-event/route.ts");

  for (const event of [
    "recommendation_bypass",
    "navigation_recovery",
    "workflow_stage",
    "advanced_detail_dependency",
  ]) {
    assert.ok(client.includes(`"${event}"`), `client must expose ${event}`);
    assert.ok(endpoint.includes(`"${event}"`), `endpoint must accept ${event}`);
  }

  assert.match(telemetry, /data-workflow-stage/);
  assert.match(telemetry, /before_primary_action/);
  assert.match(telemetry, /alternate_action/);
  assert.match(telemetry, /launcher_opened/);

  for (const forbidden of ["rawQuery", "creativeText", "trackTitle", "promptText"]) {
    assert.equal(endpoint.includes(forbidden), false, `telemetry must not accept ${forbidden}`);
    assert.equal(client.includes(forbidden), false, `client must not expose ${forbidden}`);
  }
});
