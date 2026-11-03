import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function compile(code) {
  return ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

async function runwayModule() {
  const lifecycle = { exports: {} };
  new Function("module", "exports", compile(await read("lib/marketing/release-lifecycle.ts")))(lifecycle, lifecycle.exports);
  const runtime = { exports: {} };
  const required = (name) => {
    assert.equal(name, "@/lib/marketing/release-lifecycle");
    return lifecycle.exports;
  };
  new Function("module", "exports", "require", compile(await read("lib/studio/release-runway.ts")))(runtime, runtime.exports, required);
  return runtime.exports;
}

function release(id, date, status = "Scheduled", publish_state = "draft") {
  return { id, title: `Release ${id}`, release_date: date, status, publish_state };
}

test("release runway excludes catalog, live, archived and unscheduled items", async () => {
  const { buildReleaseRunway } = await runwayModule();
  const entries = buildReleaseRunway([
    release("old", "2026-10-01"),
    release("active", "2026-12-01", "Live", "live"),
    release("archive", "2026-12-04", "Archived", "archived"),
    release("none", null, "Idea"),
    release("upcoming", "2026-12-18"),
  ], "2026-11-03");
  assert.deepEqual(entries.map((item) => item.id), ["upcoming"]);
});

test("runway dates and suggested milestones are deterministic across time zones", async () => {
  const { buildReleaseRunway } = await runwayModule();
  const [entry] = buildReleaseRunway([release("first", "2026-12-18")], "2026-11-03");
  assert.equal(entry.daysUntil, 45);
  assert.deepEqual(entry.milestones.map((item) => item.date), [
    "2026-11-27", "2026-12-04", "2026-12-18",
  ]);
  assert.equal(entry.milestones[2].title, "Planned release date");
  assert.match(entry.milestones[2].detail, /not proof of accepted distributor submission/);
});

test("same-day and close release dates warn without changing any schedule", async () => {
  const { buildReleaseRunway } = await runwayModule();
  const input = [release("c", "2027-02-10"), release("a", "2027-01-15"), release("b", "2027-01-15")];
  const original = JSON.stringify(input);
  const entries = buildReleaseRunway(input, "2026-12-01");
  assert.deepEqual(entries.map((item) => item.id), ["a", "b", "c"]);
  assert.equal(entries[0].spacingDays, 0);
  assert.equal(entries[0].spacingWarning, true);
  assert.equal(entries[1].spacingWarning, true);
  assert.equal(entries[2].spacingWarning, false);
  assert.equal(JSON.stringify(input), original, "A calendar projection must never reschedule canonical release dates");
});

test("time-shortfall is advisory and no external publication or provider calls occur", async () => {
  const { buildReleaseRunway } = await runwayModule();
  const [entry] = buildReleaseRunway([release("soon", "2026-11-08")], "2026-11-03");
  assert.equal(entry.preparationWindowShort, true);
  assert.equal(entry.daysUntil, 5);
  const model = await read("lib/studio/release-runway.ts");
  assert.doesNotMatch(model, /\.insert\(|\.update\(|\.rpc\(|submitRelease\(|publishRelease\(/);
  const page = await read("app/studio/(protected)/releases/page.tsx");
  const component = await read("components/studio/release-runway.tsx");
  assert.match(page, /ReleaseRunway releases=\{enriched\}/);
  assert.match(component, /This is planning, not distributor confirmation/);
  assert.match(component, /Less than 21 days remain/);
});
