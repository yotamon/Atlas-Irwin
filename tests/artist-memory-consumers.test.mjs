import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(`${process.cwd()}/${path}`, "utf8");

test("Artist Memory consumers declare allowlists and maximum effects", async () => {
  const domain = await read("lib/artist-memory/domain.ts");
  for (const consumer of ["moment_ranking", "creative_direction", "video_director", "campaign_planning", "growth", "audience_assistance"]) {
    assert.match(domain, new RegExp(`${consumer}: \\{`));
  }
  assert.match(domain, /moment_ranking:[\s\S]*maxEffect: "rank_only"/);
  assert.match(domain, /creative_direction:[\s\S]*maxEffect: "brief_only"/);
  assert.match(domain, /growth:[\s\S]*maxEffect: "rank_only"/);
  assert.match(domain, /audience_assistance:[\s\S]*maxEffect: "prepare_copy_only"/);
  assert.match(domain, /audience_assistance:[\s\S]*allowedClasses: \["identity", "creative_rule", "provenance_compliance"\]/);
  assert.match(domain, /filter\(\(item\) => item\.lifecycle === "active"\)/);
  assert.match(domain, /policy\.minimumLearnedConfidence/);
});

test("outcome-first Create consumes memory only as a creative brief", async () => {
  const create = await read("app/studio/create-actions.ts");
  assert.match(create, /consumer: "creative_direction"/);
  assert.match(create, /artistMemoryBrief/);
  assert.match(create, /Bounded Artist Memory/);
  assert.match(create, /production_notes/);
  assert.doesNotMatch(create, /update\([\s\S]*moments/);
  assert.doesNotMatch(create, /state.*approved.*memory/i);
});

test("Paid Growth exposes bounded memory as supporting context without spend authority", async () => {
  const page = await read("app/studio/(protected)/growth/paid/page.tsx");
  assert.match(page, /loadArtistMemoryForConsumer/);
  assert.match(page, /consumer: "growth"/);
  assert.match(page, /Artist Memory can support the hypothesis, not authorize the spend/);
  assert.match(page, /Maximum effect: rank opportunities only/);
  assert.doesNotMatch(page, /budget_ceiling_usd[^\n]*growthMemory/);
  assert.doesNotMatch(page, /approvePaidGrowthExperiment\(growthMemory/);
});

test("bounded consumer loader fails soft and keeps briefs bounded", async () => {
  const loader = await read("lib/artist-memory/consumer-context.ts");
  assert.match(loader, /export async function loadBoundedArtistMemoryContext/);
  assert.match(loader, /maxCharacters\?: number/);
  assert.match(loader, /1_800/);
  assert.match(loader, /catch/);
  assert.match(loader, /return null;/);
  assert.match(loader, /must never become a new availability/);
});

test("Moment ranking consumes memory rank-only without double counting calibration", async () => {
  const ranker = await read("lib/artist-memory/moment-ranking.ts");
  assert.match(ranker, /export function rankMomentsWithArtistMemory/);
  assert.match(ranker, /kind === "moment_calibration"\) continue;/);
  assert.match(ranker, /Math\.min\(0\.04, /);
  assert.match(ranker, /Math\.max\(-0\.04, /);
  assert.match(ranker, /NEGATIVE_TERMS/);
});

test("video director and campaign planning honor their maximum effects", async () => {
  const video = await read("lib/video-director/context.ts");
  assert.match(video, /loadBoundedArtistMemoryContext/);
  assert.match(video, /consumer: "video_director"/);
  assert.match(video, /maxEffect === "brief_only"/);

  const campaign = await read("lib/marketing/ai.ts");
  assert.match(campaign, /loadBoundedArtistMemoryContext/);
  assert.match(campaign, /consumer: "campaign_planning"/);
  assert.match(campaign, /maxEffect === "suggest_only"/);
});
