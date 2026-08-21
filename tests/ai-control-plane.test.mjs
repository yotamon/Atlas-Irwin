import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Control Plane persists complete request telemetry and budget settings", async () => {
  const migration = await source("supabase/migrations/20260820172743_ai_control_plane.sql");
  for (const column of [
    "task_type", "requested_model", "routed_provider", "gateway_generation_id",
    "video_project_id", "parent_run_id", "latency_ms", "input_tokens", "output_tokens",
    "actual_cost_usd", "fallback_used", "escalated", "quality_gate_passed",
    "quality_score", "user_outcome", "edit_distance_ratio",
  ]) assert.match(migration, new RegExp(`add column ${column}`));
  assert.match(migration, /create table public\.ai_control_settings/);
  assert.match(migration, /monthly_budget_usd/);
  assert.match(migration, /quality_escalation/);
  assert.match(migration, /provider_sort/);
});

test("human and performance choices become durable AI feedback events", async () => {
  const migration = await source("supabase/migrations/20260820172743_ai_control_plane.sql");
  assert.match(migration, /create table public\.ai_feedback_events/);
  assert.match(migration, /record_ai_variant_feedback/);
  assert.match(migration, /record_ai_content_feedback/);
  assert.match(migration, /record_ai_video_concept_feedback/);
  assert.match(migration, /record_ai_video_plan_feedback/);
  assert.match(migration, /record_ai_performance_feedback/);
  assert.match(migration, /record_ai_regeneration_feedback/);
});

test("Campaign Brain links generated content to the canonical Control Plane run", async () => {
  const actions = await source("app/studio/marketing-actions.ts");
  assert.match(actions, /controlPlaneRunId/);
  assert.match(actions, /\.update\(\{[\s\S]*campaign_id: campaignId[\s\S]*output: json\(plan\)/);
  assert.match(actions, /generation\.provider === "template" \? "planner" : "ai"/);
  assert.match(actions, /generated_from_run_id: generationRun\.id/);
  assert.match(actions, /generation_run_id: generationRun\.id/);
});

test("adaptive routing requires evidence, stays within approved models and fails open", async () => {
  const controlPlane = await source("lib/ai/control-plane.ts");
  const analytics = await source("lib/ai/analytics.ts");
  const learning = await source("lib/ai/learning.ts");
  assert.match(controlPlane, /learnedRouteForTask/);
  assert.match(controlPlane, /const primaryModels = learnedRouting\.route/);
  assert.match(controlPlane, /configuredRoute: policy\.models/);
  assert.match(controlPlane, /learnedRoutingApplied/);
  assert.match(controlPlane, /Adaptive evidence is temporarily unavailable; using the configured route/);
  assert.match(analytics, /Adaptive evidence is temporarily unavailable; using the configured route/);
  assert.match(learning, /MIN_COMPLETED_SAMPLES = 6/);
  assert.match(learning, /MIN_HUMAN_SAMPLES = 3/);
  assert.match(learning, /settings\.routing_mode !== "auto"/);
  assert.match(learning, /policy\.models\.filter/);
  assert.doesNotMatch(learning, /tierModels\(/);
});

test("AI Control Center exposes cost quality configured and learned routing without secrets", async () => {
  const page = await source("app/studio/(protected)/settings/ai/page.tsx");
  assert.match(page, /AI & Generation/);
  assert.match(page, /First-pass quality/);
  assert.match(page, /Semantic escalations/);
  assert.match(page, /Human quality signal/);
  assert.match(page, /Task intelligence/);
  assert.match(page, /Model economics/);
  assert.match(page, /Routing policy/);
  assert.match(page, /Adaptive learning/);
  assert.match(page, /Evidence-gated effective routes/);
  assert.match(page, /Configured route/);
  assert.match(page, /Recent AI attempts/);
  assert.doesNotMatch(page, /AI_GATEWAY_API_KEY/);
  assert.doesNotMatch(page, /VERCEL_OIDC_TOKEN/);
});

test("specialist paid media remains outside semantic retry transport", async () => {
  const director = await source("lib/video-director/openai-director.ts");
  const generation = await source("lib/video-director/generation.ts");
  assert.match(director, /runAtlasAiTask/);
  assert.doesNotMatch(director, /HiggsfieldProvider/);
  assert.match(generation, /createApprovalEnvelope/);
  assert.match(generation, /reserved_credits/);
  assert.match(generation, /approval_id/);
});

test("Zero Cost mode blocks specialist media at the provider boundary", async () => {
  const controlPlane = await source("lib/ai/control-plane.ts");
  const actions = await source("app/studio/ai-control-actions.ts");
  const page = await source("app/studio/(protected)/settings/ai/page.tsx");
  const marketingCreative = await source("app/studio/marketing-creative-actions.ts");
  const videoGeneration = await source("lib/video-director/generation.ts");
  assert.match(controlPlane, /ZERO_COST_TEXT_BUDGET_USD = 2\.25/);
  assert.match(controlPlane, /assertSpecialistMediaSpendAllowed/);
  assert.match(actions, /applyZeroCostPreset/);
  assert.match(actions, /image_budget_usd: 0/);
  assert.match(actions, /video_budget_usd: 0/);
  assert.match(page, /Zero Cost mode/);
  assert.match(page, /Image hard cap/);
  const marketingGuard = marketingCreative.indexOf("await assertSpecialistMediaSpendAllowed({");
  const marketingSubmit = marketingCreative.indexOf("provider.submit(");
  assert.ok(marketingGuard >= 0 && marketingSubmit > marketingGuard);
  const videoApprovalGuard = videoGeneration.indexOf("await assertSpecialistMediaSpendAllowed({ ownerId: input.ownerId");
  const videoApprovalInsert = videoGeneration.indexOf('from("music_video_approvals").insert');
  assert.ok(videoApprovalGuard >= 0 && videoApprovalInsert > videoApprovalGuard);
  const videoSubmit = videoGeneration.indexOf("export async function submitGeneration");
  const videoSubmitGuard = videoGeneration.indexOf("await assertSpecialistMediaSpendAllowed({", videoSubmit);
  const reserve = videoGeneration.indexOf("reserve_music_video_generation", videoSubmit);
  assert.ok(videoSubmit >= 0 && videoSubmitGuard > videoSubmit && reserve > videoSubmitGuard);
});

test("AI tasks reuse quality-approved deterministic results and escalate cheaply", async () => {
  const controlPlane = await source("lib/ai/control-plane.ts");
  const tasks = await source("lib/ai/tasks.ts");
  assert.match(controlPlane, /taskCacheKey/);
  assert.match(controlPlane, /contains\("metadata", \{ cacheKey, cacheEligible: true \}\)/);
  assert.match(controlPlane, /if \(cacheMode === "use"\)/);
  assert.ok(controlPlane.indexOf('if (cacheMode === "use")') < controlPlane.indexOf("const budget = await enforceBudget"));
  assert.match(controlPlane, /quality_gate_passed", true/);
  assert.match(controlPlane, /cacheHit: true/);
  assert.match(controlPlane, /provider: "atlas-cache"/);
  assert.match(controlPlane, /cacheSourceRunId/);
  assert.match(tasks, /zai\/glm-4\.7-flash/);
  assert.match(tasks, /openai\/gpt-5\.6-luna/);
  assert.match(tasks, /openai\/gpt-5\.6-sol/);
  assert.match(tasks, /"video\.concepts"[\s\S]*tier: "balanced"[\s\S]*escalationTier: "premium"/);
  assert.match(tasks, /"video\.production_plan"[\s\S]*tier: "balanced"[\s\S]*escalationTier: "premium"/);
  assert.match(controlPlane, /for \(let index = 0; index < policy\.escalationModels\.length; index \+= 1\)/);
});
