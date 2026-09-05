import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Marketing Intelligence surfaces at most five strong non-overlapping full Moments", async () => {
  const engine = await source("lib/marketing/marketing-intelligence.ts");
  assert.match(engine, /selectMarketingMoments/);
  assert.match(engine, /intervalOverlap/);
  assert.match(engine, /moment\.endMs - moment\.startMs >= 4_000/);
  assert.match(engine, /moment\.endMs - moment\.startMs <= 60_000/);
  assert.match(engine, /Math\.min\(limit, 5\)/);
  assert.match(engine, /moment\.state === "approved"/);
  assert.match(engine, /startMs: moment\.startMs/);
  assert.match(engine, /endMs: moment\.endMs/);
  assert.match(engine, /slice\(0, 5\)/);
  const context = await source("lib/marketing/marketing-intelligence-action-context.ts");
  assert.match(context, /audioSceneId: null/);
});

test("generic filler is hard-rejected and never backfilled just to satisfy a quota", async () => {
  const engine = await source("lib/marketing/marketing-intelligence.ts");
  assert.match(engine, /Too semantically similar to existing artist content/);
  assert.match(engine, /Not specific enough to this artist\/release/);
  assert.match(engine, /generic promotional or AI-content tropes/);
  assert.match(engine, /Music-led video requires an approved curated Moment before production/);
  assert.match(engine, /Never backfill hard-rejected ideas just to hit a content quota/);
  assert.match(engine, /candidate\.publishability\.score >= 62/);
});

test("full product funnel reaches fandom and superfan rather than stopping at conversion", async () => {
  const layer = await source("lib/marketing/marketing-intelligence-product-layer.ts");
  for (const stage of ["discovery", "interest", "resonance", "relationship", "listening", "fandom", "superfan"]) {
    assert.ok(layer.includes(`\"${stage}\"`), `missing full-funnel stage: ${stage}`);
  }
  assert.match(layer, /FULL_MARKETING_FUNNEL/);
  assert.match(layer, /funnelStageForGoal/);
  assert.match(layer, /without over-monetizing the relationship/);
});

test("Artist Marketing DNA supports all seven artist archetypes and mixed identities", async () => {
  const layer = await source("lib/marketing/marketing-intelligence-product-layer.ts");
  for (const archetype of ["performer", "storyteller", "producer", "selector_dj", "world_builder", "community_artist", "faceless_virtual"]) {
    assert.ok(layer.includes(`\"${archetype}\"`), `missing artist archetype: ${archetype}`);
  }
  assert.match(layer, /secondaryArchetypes/);
  assert.match(layer, /inferArchetypes/);
});

test("content pillars are dynamic, canonical and objective-prioritized", async () => {
  const layer = await source("lib/marketing/marketing-intelligence-product-layer.ts");
  for (const pillar of ["Music", "Story", "Process", "World", "Personality", "Community", "Proof", "Conversion", "Catalogue"]) {
    assert.ok(layer.includes(`\"${pillar}\"`), `missing dynamic content pillar: ${pillar}`);
  }
  assert.match(layer, /deriveContentPillars/);
  assert.match(layer, /input\.objective === "Streams"/);
  assert.match(layer, /\.slice\(0, 6\)/);
});

test("Creative Memory semantic descriptors and preferences feed planning and duplicate evidence", async () => {
  const build = await source("lib/marketing/marketing-intelligence-build.ts");
  assert.match(build, /loadArtistCreativeMemory/);
  assert.match(build, /semanticDescriptors/);
  assert.match(build, /visualDescriptors/);
  assert.match(build, /creativeMemory\.preferences\.positive/);
  assert.match(build, /creativeMemory\.preferences\.negative/);
  assert.match(build, /Creative Memory semantic descriptor/);
  assert.match(build, /previousCreative = \[\.\.\.historicalCreative, \.\.\.memoryCreative\]/);
  assert.match(build, /Near-duplicate memory asset/);
});

test("Production Cards are executable briefs with exact audio integrity, shots, assets and KPIs", async () => {
  const engine = await source("lib/marketing/marketing-intelligence.ts");
  for (const contract of [
    "audioIntegrityRule",
    "Use the full curated Moment boundaries exactly",
    "shotList",
    "assetChecklist",
    "sourcePlan",
    "Real artist/release footage",
    "primaryKpi",
    "OBJECTIVE_KPIS",
    "generationPolicy: \"real_first\"",
  ]) assert.ok(engine.includes(contract), `missing Production Card contract: ${contract}`);
});

test("campaign refresh stages the replacement before switching away from the active plan", async () => {
  const build = await source("lib/marketing/marketing-intelligence-build.ts");
  const persist = await source("lib/marketing/marketing-intelligence-persist.ts");
  assert.match(build, /\.eq\("state", "approved"\)/);
  assert.match(build, /selectMarketingMoments\(/);
  assert.match(build, /,\n    5,\n  \)/);
  assert.match(persist, /Snapshot the currently active replaceable plan/);
  assert.match(persist, /Stage every new content item, variant and attribution link before touching the active plan/);
  assert.match(persist, /rollbackStagedPlan/);
  assert.match(persist, /restorePreviousMoments/);
  assert.match(persist, /replacementMode: "staged_then_commit"/);
  assert.match(persist, /moment_id: musicMoment\?\.id/);
  assert.match(persist, /audio_timestamp_start: null/);
  assert.match(persist, /audio_timestamp_end: null/);
  assert.match(persist, /Exact boundaries remain canonical on the approved Moment in milliseconds/);
  assert.doesNotMatch(persist, /audio_scene_id/);
  const stageIndex = persist.indexOf("Stage every new content item");
  const cleanupIndex = persist.indexOf("The new plan is now active");
  assert.ok(stageIndex >= 0 && cleanupIndex > stageIndex, "old-plan cleanup must happen only after the new plan is staged and committed");
  assert.match(persist, /campaign\.intelligence_refreshed/);
  assert.match(persist, /campaign_moments/);
  assert.match(persist, /refresh telemetry failed after commit/);
  assert.doesNotMatch(persist, /if \(eventError\) throw new Error\(eventError\.message\)/);
});

test("final social finishing resolves exact approved Moment milliseconds and rejects mismatched Audio Scenes", async () => {
  const production = await source("lib/marketing/media-production.ts");
  assert.match(production, /moment_id/);
  assert.match(production, /moment\.start_ms \/ 1000/);
  assert.match(production, /moment\.end_ms \/ 1000/);
  assert.match(production, /source: "approved_moment"/);
  assert.match(production, /exactMomentDuration/);
  assert.match(production, /final social master follows the reviewed musical Moment/);
  assert.match(production, /sceneCoversMoment/);
  assert.match(production, /windowStartMs - scene\.startMs!/);
  assert.match(production, /Selected Audio Scene does not cover the approved musical Moment/);
  assert.match(production, /audio_window_source/);
  assert.match(production, /finish-social-video:\$\{input\.generationRunId\}:v3/);
});

test("approve/reject feedback becomes artist-scoped closed-loop learning", async () => {
  const feedback = await source("lib/marketing/marketing-intelligence-feedback-runtime.ts");
  const reasons = await source("lib/marketing/marketing-intelligence-rejection-reasons.ts");
  assert.match(feedback, /content\.variant_approved/);
  assert.match(feedback, /content\.variant_rejected/);
  assert.match(feedback, /Campaign Intelligence feedback must belong to a campaign-linked content item/);
  assert.match(feedback, /scope: "content"/);
  assert.match(feedback, /status: "approved"/);
  assert.match(feedback, /confidence: 0\.96/);
  assert.match(feedback, /source: "manual"/);
  assert.match(feedback, /hookText: variant\.hook_text/);
  assert.match(feedback, /contentAngle: item\.content_angle/);
  assert.match(reasons, /Too generic \/ could belong to anyone/);
});

test("Campaign Intelligence UI exposes evidence without pseudo-precise quality scores", async () => {
  const page = await source("app/studio/(protected)/campaigns/[id]/intelligence/page.tsx");
  for (const contract of [
    "Artist Marketing DNA",
    "Dynamic content pillars",
    "Strongest reusable Moments",
    "Funnel strategy",
    "Not cross-posting",
    "Platform Directors",
    "Production cards",
    "Shot list",
    "Assets",
    "Ideas worth developing",
    "Artist-normalized analytics",
    "Reject + teach Ensemblis",
    "Build intelligent campaign",
  ]) assert.ok(page.includes(contract), `missing Campaign Intelligence UI contract: ${contract}`);
  assert.match(page, /secondaryArchetypes/);
  assert.match(page, /contentPillars/);
  assert.match(page, /qualityEvidence/);
  assert.match(page, /Strong artist and release specificity/);
  assert.match(page, /Clearly distinct from recent artist content/);
  assert.match(page, /filter\(\(reason\) => !\/\\d\+\\\/100 artist\\\/release specificity/);
  assert.match(page, /filter\(\(reason\) => !\/\\d\+% semantic novelty/);
  assert.doesNotMatch(page, /Avg publishability/);
  assert.doesNotMatch(page, /marketing fit/);
  assert.doesNotMatch(page, /publishability<\/span>/);
  assert.match(page, /quality evidence/);
  assert.match(page, /marketing-intelligence-rejection-reasons/);
});

test("paid creative generation has artist-specificity and music gates before provider spend", async () => {
  const quality = await source("lib/marketing/creative-quality.ts");
  assert.match(quality, /artist-specificity/);
  assert.match(quality, /specificityScore/);
  assert.match(quality, /artist-specificity-v2/);
  assert.match(quality, /first-second/);
  assert.match(quality, /real-first/);
  assert.match(quality, /Paid music video generation is blocked/);
  assert.match(quality, /Raw generation prompt must explicitly exclude rendered text, logos and UI\./);
});

test("Creative DNA consumes explicit content rejection reasons", async () => {
  const dna = await source("lib/marketing/creative-dna.ts");
  assert.match(dna, /artist-creative-dna-v2/);
  assert.match(dna, /content\.variant_rejected/);
  assert.match(dna, /explicitFeedback/);
  assert.match(dna, /generic concepts that could belong to any artist/);
  assert.match(dna, /ad-like promotional framing/);
  assert.match(dna, /loadArtistCreativeDna/);
});

test("Campaign workspace navigation makes Intelligence a first-class view and server actions stay thin", async () => {
  const layout = await source("app/studio/(protected)/campaigns/[id]/layout.tsx");
  const actions = await source("app/studio/marketing-intelligence-actions.ts");
  const execution = await source("app/studio/(protected)/campaigns/[id]/page.tsx");
  assert.match(layout, /Campaign Intelligence/);
  assert.match(layout, /\/intelligence/);
  assert.match(actions, /^"use server";/);
  assert.match(actions, /buildCampaignIntelligence/);
  assert.match(actions, /persistCampaignIntelligence/);
  assert.doesNotMatch(actions, /MARKETING_REJECTION_REASONS/);
  assert.match(execution, /refreshCampaignIntelligence/);
  assert.doesNotMatch(execution, /generateCampaignStrategy/);
});
