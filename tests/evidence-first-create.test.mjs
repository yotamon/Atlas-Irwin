import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Create explains recommended Moments with evidence instead of pseudo-precise percentages", async () => {
  const create = await source("app/studio/(protected)/create/page.tsx");
  assert.ok(create.includes("momentEvidenceSummary"));
  assert.ok(create.includes("<strong>Recommended</strong>"));
  assert.ok(create.includes("Why: {evidence}"));
  assert.ok(create.includes("evidence-backed musical starting point"));
  assert.equal(create.includes("Math.round(moment.confidence * 100)"), false);
});

test("Track Intelligence keeps internal ranking but presents qualitative recommendation language", async () => {
  const preview = await source("components/studio/music-intelligence-preview.tsx");
  assert.ok(preview.includes("analysisConfidenceLabel"));
  assert.ok(preview.includes("hookRecommendationLabel"));
  assert.ok(preview.includes("Strongest moments"));
  assert.equal(preview.includes("Math.round(confidence * 100)"), false);
  assert.equal(preview.includes("Math.round(topIntent[1] * 100)"), false);
  assert.equal(preview.includes("Math.round(hook.score * 100)"), false);
});

test("qualitative evidence labels preserve ranking inputs without exposing fake precision", async () => {
  const labels = await source("lib/studio/evidence-labels.ts");
  for (const phrase of [
    "High-confidence analysis",
    "Good evidence coverage",
    "Preliminary analysis",
    "Best fit",
    "Strong fit",
    "Multiple signals agree",
    "Strong hook signal",
    "Lyric timing supports it",
  ]) assert.ok(labels.includes(phrase), `evidence labels must retain ${phrase}`);
  assert.equal(labels.includes("%"), false, "artist-facing evidence labels must remain categorical");
});