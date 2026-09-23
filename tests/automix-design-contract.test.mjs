import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("AutoMix uses the V4 workflow instead of stacking specialist panels", async () => {
  const page = await source("app/studio/(protected)/music/automix/page.tsx");
  const workflow = await source("components/studio/automix-workflow.tsx");

  assert.ok(page.includes("<AutoMixWorkflow"));
  assert.ok(page.includes('title="AutoMix"'));
  assert.ok(page.includes('href={href("/studio/music?view=mixes")}'));

  for (const legacyPanel of [
    "DjIntelligencePanel",
    "LibraryBridgePanel",
    "RekordboxImportPanel",
    "LocalSetBuilderWorkspace",
    "SetBuilderWorkspace",
    "AutoMixRenderRecovery",
  ]) {
    assert.equal(page.includes(`<${legacyPanel}`), false, `${legacyPanel} must not be stacked directly by the page`);
  }

  for (const marker of [
    "Where should the music come from?",
    "This computer",
    "Ensemblis catalog",
    'summary>DJ preferences & connection tools',
    "<ConnectionWidget",
    "initialMixId",
  ]) assert.ok(workflow.includes(marker), `AutoMix workflow is missing ${marker}`);
});

test("both AutoMix runtimes share Music → Intent → Build → Review → Render", async () => {
  const local = await source("components/studio/local-set-builder-workspace.tsx");
  const catalog = await source("components/studio/set-builder-workspace.tsx");
  const widgets = await source("components/studio/ux-v4-widgets.tsx");
  const css = await source("app/studio/design-system/workflows.css");

  for (const builder of [local, catalog]) {
    assert.ok(builder.includes("<WorkflowStepper"));
    for (const stage of ["music", "intent", "build", "review", "render"]) {
      assert.ok(builder.includes(`id: "${stage}"`), `builder lost the ${stage} stage`);
    }
    assert.ok(builder.includes('setStage("render")'));
    assert.ok(builder.includes("initialMixId"));
  }

  assert.ok(widgets.includes("export function WorkflowStepper"));
  assert.ok(css.includes(".en-workflow-stepper"));
  assert.ok(css.includes("@media (max-width: 760px)"));
});

test("advanced DJ machinery remains available without defining the default workflow", async () => {
  const workflow = await source("components/studio/automix-workflow.tsx");
  assert.ok(workflow.includes("<DjIntelligencePanel"));
  assert.ok(workflow.includes("<LibraryBridgePanel"));
  assert.ok(workflow.includes("<RekordboxImportPanel"));
  assert.ok(workflow.indexOf("<details") < workflow.indexOf("<DjIntelligencePanel"));
});
