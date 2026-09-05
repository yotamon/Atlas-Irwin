import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(`${process.cwd()}/${path}`, "utf8");

test("Grow keeps synthetic ranking precision internal", async () => {
  const [grow, evidence] = await Promise.all([
    read("app/studio/(protected)/growth/page.tsx"),
    read("lib/studio/evidence-labels.ts"),
  ]);
  assert.doesNotMatch(grow, /\/100 portfolio score/i);
  assert.doesNotMatch(grow, /% confidence/i);
  assert.doesNotMatch(grow, /name="hook_strength"|name="brand_fit"|name="trend_momentum"|name="confidence"/i);
  assert.match(grow, /evidenceStrengthLabel/);
  assert.match(grow, /Strong evidence|evidence/i);
  assert.match(evidence, /Strong evidence/);
  assert.match(evidence, /Supported by evidence/);
  assert.match(evidence, /Preliminary evidence/);
});

test("primary decision surfaces use the shared Required / Needs attention / Clear posture", async () => {
  const [today, needsYou, distribution, paid] = await Promise.all([
    read("app/studio/(protected)/page.tsx"),
    read("app/studio/(protected)/needs-you/page.tsx"),
    read("app/studio/(protected)/releases/[id]/distribution/release-distribution-artist-view.tsx"),
    read("app/studio/(protected)/growth/paid/page.tsx"),
  ]);
  assert.match(today, /Required|Needs attention|Clear/);
  assert.match(needsYou, /Needs attention|Clear|Blocked/);
  assert.match(distribution, /Needs you/i);
  assert.match(paid, /Needs You|approval|Stop/i);
});

test("provider complexity stays behind advanced disclosure on artist-owned workflows", async () => {
  const [distributionRoute, grow] = await Promise.all([
    read("app/studio/(protected)/releases/[id]/distribution/page.tsx"),
    read("app/studio/(protected)/growth/page.tsx"),
  ]);
  assert.match(distributionRoute, /<details[\s\S]*Advanced provider tools/);
  assert.match(grow, /<details[\s\S]*Advanced planning tools/);
});