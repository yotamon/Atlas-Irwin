import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function domainModule() {
  const source = await read("lib/marketing/release-visual.ts");
  const lifecycle = await read("lib/marketing/release-lifecycle.ts");
  const stitched = lifecycle
    .replace(/export /g, "")
    .concat("\n", source
      .replace('import { dayDistance, releaseLifecycle } from "@/lib/marketing/release-lifecycle";', "")
      .replace(/export /g, ""));
  const compiled = ts.transpileModule(stitched, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  const fn = new Function("runtimeModule", "exports", compiled.replaceAll("module.exports", "runtimeModule.exports") + "\nruntimeModule.exports = { defaultReleaseVisualMessage, defaultReleaseVisualCopy, deriveReleaseVisualStage, releaseVisualRoleForPackage };");
  const runtimeModule = { exports: exportsObject };
  fn(runtimeModule, exportsObject);
  return runtimeModule.exports;
}

test("visual Create outcome stays compatible but is release-owned", async () => {
  const outcomes = await read("lib/studio/create-outcomes.ts");
  assert.match(outcomes, /id: "visual"/);
  assert.match(outcomes, /shortLabel: "Create release visuals"/);
  assert.match(outcomes, /workflow: "release_visual"/);
  assert.match(outcomes, /sourceMode: "release"/);
  assert.match(outcomes, /mediaKind: "image"/);
});

test("Moment creative directions exclude the release-owned visual outcome", async () => {
  const directions = await read("lib/studio/creative-directions.ts");
  assert.match(directions, /CREATE_OUTCOMES\.filter\(\(outcome\) => outcome\.sourceMode === "moment"\)/);
});

test("Release Visual defines one five-stage contextual workflow", async () => {
  const domain = await read("lib/marketing/release-visual.ts");
  for (const stage of ["source", "message", "design", "review", "use"]) {
    assert.ok(domain.includes(`"${stage}"`), `missing stage ${stage}`);
  }
  assert.match(domain, /RELEASE_VISUAL_MARKER = "\[release-visual:v1\]"/);
});

test("release lifecycle chooses bounded promotional defaults", async () => {
  const domain = await domainModule();

  assert.equal(domain.defaultReleaseVisualMessage({
    releaseDate: null,
    status: "Draft",
    now: new Date("2026-10-06T10:00:00Z"),
  }), "clean");

  assert.equal(domain.defaultReleaseVisualMessage({
    releaseDate: "2026-10-09",
    status: "Draft",
    now: new Date("2026-10-06T10:00:00Z"),
  }), "out_friday");

  assert.equal(domain.defaultReleaseVisualMessage({
    releaseDate: "2026-10-23",
    status: "Draft",
    now: new Date("2026-10-06T10:00:00Z"),
  }), "pre_save");

  assert.equal(domain.defaultReleaseVisualMessage({
    releaseDate: "2026-10-05",
    status: "Live",
    now: new Date("2026-10-06T10:00:00Z"),
  }), "out_now");

  assert.equal(domain.defaultReleaseVisualMessage({
    releaseDate: "2026-08-01",
    status: "Live",
    now: new Date("2026-10-06T10:00:00Z"),
  }), "listen_now");
});

test("Out Friday copy never invents a date", async () => {
  const domain = await domainModule();
  const withoutDate = domain.defaultReleaseVisualCopy({
    intent: "out_friday",
    releaseTitle: "Signal",
    artistName: "Artist",
    releaseDate: null,
  });
  assert.equal(withoutDate.headline, "OUT FRIDAY");
  assert.equal(withoutDate.dateLabel, null);

  const withDate = domain.defaultReleaseVisualCopy({
    intent: "out_friday",
    releaseTitle: "Signal",
    artistName: "Artist",
    releaseDate: "2026-10-09",
  });
  assert.equal(withDate.dateLabel, "Oct 9");
});

test("stage derivation comes from canonical readiness rather than persisted workflow state", async () => {
  const domain = await domainModule();
  assert.equal(domain.deriveReleaseVisualStage({ sourceReady: false, messageReady: false, designReady: false, approved: false }), "source");
  assert.equal(domain.deriveReleaseVisualStage({ sourceReady: true, messageReady: false, designReady: false, approved: false }), "message");
  assert.equal(domain.deriveReleaseVisualStage({ sourceReady: true, messageReady: true, designReady: false, approved: false }), "design");
  assert.equal(domain.deriveReleaseVisualStage({ sourceReady: true, messageReady: true, designReady: true, approved: false }), "review");
  assert.equal(domain.deriveReleaseVisualStage({ sourceReady: true, messageReady: true, designReady: true, approved: true }), "use");
});


test("Release Visual Create start is release-first and resumable", async () => {
  const page = await read("app/studio/(protected)/create/page.tsx");
  const actions = await read("app/studio/create-actions.ts");

  assert.match(page, /Create a release visual/);
  assert.match(page, /name="release_id"/);
  assert.match(page, /name="outcome" value="visual"/);
  assert.match(page, /Release Visual remains available above/);
  assert.match(actions, /outcome\.sourceMode === "release"/);
  assert.match(actions, /moment_id: null/);
  assert.match(actions, /RELEASE_VISUAL_MARKER/);
  assert.match(actions, /\/studio\/create\/visual\//);
  assert.match(actions, /Could not start Release Visual/);
});

test("static Instagram packages are canonical and safe-area aware", async () => {
  const packages = await read("lib/marketing/platform-packages.ts");
  assert.match(packages, /id: "instagram-story-image"[\s\S]*?width: 1080,[\s\S]*?height: 1920/);
  assert.match(packages, /id: "instagram-feed-portrait"[\s\S]*?width: 1080,[\s\S]*?height: 1350/);
  assert.match(packages, /id: "instagram-square"[\s\S]*?width: 1080,[\s\S]*?height: 1080/);
  assert.match(packages, /safeArea/);
});

test("Release Visual uses one deterministic renderer for preview and final PNG", async () => {
  const composer = await read("components/studio/release-visual-composer.tsx");
  const layout = await read("lib/marketing/release-visual-layout.ts");
  const actions = await read("app/studio/release-visual-actions.ts");

  assert.match(composer, /export async function renderReleaseVisual/);
  assert.match(composer, /await document\.fonts\.ready/);
  assert.match(composer, /measuredTextBlock/);
  assert.match(composer, /saveReleaseVisualCandidate/);
  assert.match(layout, /target\.safeArea/);
  assert.match(layout, /rankReleaseVisualLayouts/);
  assert.match(actions, /pngDimensions/);
  assert.match(actions, /Release Visual must be exactly/);
  assert.match(actions, /provider: "ensemblis-compositor"/);
  assert.match(actions, /actual_cost_usd: 0/);
});

test("Release Visual persists one approved spec and true deterministic image derivatives", async () => {
  const actions = await read("app/studio/release-visual-actions.ts");
  const derivatives = await read("lib/marketing/creative-derivatives.ts");
  const migration = await read("supabase/migrations/20261006003000_release_visual_derivative_strategy.sql");
  const types = await read("types/creative-derivative-database.ts");

  assert.match(actions, /releaseVisualSpec: spec/);
  assert.match(derivatives, /creativeDerivativeStrategy/);
  assert.match(derivatives, /"deterministic_image_recompose"/);
  assert.match(actions, /strategy: "deterministic_image_recompose"/);
  assert.match(actions, /parent_run_id: workspace\.approvedRun\.id/);
  assert.match(actions, /zeroGenerationSpend: true/);
  assert.match(migration, /deterministic_image_recompose/);
  assert.match(types, /deterministic_image_recompose/);
});

test("approved Release Visual hands exact 9:16 bytes into Living Artwork", async () => {
  const actions = await read("app/studio/release-visual-actions.ts");
  const context = await read("lib/marketing/creative-context.ts");
  const livingWorkspace = await read("lib/marketing/living-artwork-workspace.ts");
  const livingPrep = await read("components/studio/living-artwork-loop-kit-prep.tsx");

  assert.match(actions, /animateApprovedReleaseVisual/);
  assert.match(actions, /role: LIVING_ARTWORK_EXPLICIT_SOURCE_ROLE/);
  assert.match(actions, /story\.width !== 1080 \|\| story\.height !== 1920/);
  assert.match(context, /living_artwork_source/);
  assert.match(livingWorkspace, /exactPortrait/);
  assert.match(livingPrep, /uses the exact raster as both first and last frame/);
});

test("Release Visual is contextual across Release, Today and Launcher", async () => {
  const release = await read("components/studio/release-workspace-v2.tsx");
  const today = await read("app/studio/(protected)/page.tsx");
  const snapshot = await read("lib/studio/artist-operating-snapshot.ts");
  const intent = await read("lib/studio/intent/domain.ts");

  assert.match(release, /outcome=visual/);
  assert.match(release, /Story, feed artwork, then optional motion/);
  assert.match(snapshot, /latestVisualCreative/);
  assert.match(today, /latestVisualCreative/);
  assert.match(intent, /createMode\?: "static" \| "motion" \| null/);
  assert.match(intent, /releaseVisualStaticIntent/);
});


test("Release Visual approval stays publication-compatible without a second publishing system", async () => {
  const actions = await read("app/studio/release-visual-actions.ts");
  const spec = await read("docs/superpowers/specs/2026-10-06-release-visual-workflow-design.md");

  assert.match(actions, /asset_url: workspace\.candidateAsset\.public_url/);
  assert.match(actions, /approval_status: "approved"/);
  assert.match(actions, /asset_url: stored\.publicUrl/);
  assert.doesNotMatch(actions, /create table|publication_jobs.*insert/s);
  assert.match(spec, /no auto-publish/i);
});

test("Release Visual static composition remains useful when generative visuals are disabled", async () => {
  const actions = await read("app/studio/release-visual-actions.ts");
  const composer = await read("components/studio/release-visual-composer.tsx");

  assert.doesNotMatch(actions, /creative-router|creative-provider|higgsfield|fal\.ai|veo/i);
  assert.doesNotMatch(composer, /creative-router|creative-provider|higgsfield|fal\.ai|veo/i);
  assert.match(actions, /actual_cost_usd: 0/);
  assert.match(composer, /No generative credits are used/);
});
