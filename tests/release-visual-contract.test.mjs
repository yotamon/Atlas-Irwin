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
  const exports = {};
  const fn = new Function("module", "exports", compiled + "\nmodule.exports = { defaultReleaseVisualMessage, defaultReleaseVisualCopy, deriveReleaseVisualStage, releaseVisualRoleForPackage };");
  const module = { exports };
  fn(module, exports);
  return module.exports;
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
