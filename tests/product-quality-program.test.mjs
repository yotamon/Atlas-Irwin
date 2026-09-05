import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(`${process.cwd()}/${path}`, "utf8");

test("product quality gates measure usefulness instead of implementation activity", async () => {
  const gates = JSON.parse(await read("config/product-quality-gates.json"));
  const ids = Object.keys(gates.gates ?? {});
  for (const id of [
    "moment_top5_usable_recall",
    "creative_acceptance_rate",
    "creative_median_edit_ratio",
    "onboarding_median_minutes_to_first_useful_recommendation",
    "onboarding_completion_rate",
    "release_zero_median_human_interventions",
    "mission_blocker_resolution_rate",
    "mobile_critical_path_pass_rate",
    "keyboard_critical_path_pass_rate",
    "recovery_critical_path_pass_rate",
  ]) assert.ok(ids.includes(id), `missing usefulness gate ${id}`);

  for (const gate of Object.values(gates.gates)) {
    assert.ok(["min", "max"].includes(gate.direction));
    assert.equal(typeof gate.threshold, "number");
    assert.equal(typeof gate.label, "string");
  }
});

test("quality evaluator is measurement-driven and does not pretend missing evidence passed", async () => {
  const evaluator = await read("scripts/evaluate-product-quality.mjs");
  assert.match(evaluator, /--measurements/);
  assert.match(evaluator, /status: "missing"/);
  assert.match(evaluator, /status: passed \? "pass" : "fail"/);
  assert.match(evaluator, /These gates are review thresholds, not claims about current Ensemblis performance/);
  assert.match(evaluator, /process\.argv\.includes\("--strict"\)/);
});

test("example quality measurements are explicitly non-production evidence", async () => {
  const example = JSON.parse(await read("config/product-quality-measurements.example.json"));
  assert.match(example.note, /Example input only/);
  assert.match(example.note, /Replace values with measured/);
});
