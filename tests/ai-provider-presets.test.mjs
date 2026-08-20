import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("quality presets have explicit value-for-money routes", async () => {
  const catalog = await source("lib/marketing/creative-provider-catalog.ts");
  assert.match(catalog, /economy:[\s\S]*flux-2-klein-4b/);
  assert.match(catalog, /economy:[\s\S]*vidu2-image/);
  assert.match(catalog, /balanced:[\s\S]*flux-2-pro-preview/);
  assert.match(catalog, /balanced:[\s\S]*veo-3\.1-lite-generate-preview/);
  assert.match(catalog, /premium:[\s\S]*gemini-3\.1-flash-image/);
  assert.match(catalog, /premium:[\s\S]*auto_premium/);
  assert.match(catalog, /AI_PRICING_AS_OF = "2026-08-19"/);
});

test("creative providers use direct verified APIs and never the ZAI Coding Plan endpoint", async () => {
  const providers = await source("lib/marketing/creative-providers.ts");
  assert.match(providers, /https:\/\/api\.bfl\.ai\/v1/);
  assert.match(providers, /https:\/\/generativelanguage\.googleapis\.com\/v1beta/);
  assert.match(providers, /https:\/\/api\.z\.ai\/api\/paas\/v4/);
  assert.match(providers, /https:\/\/queue\.fal\.run/);
  assert.doesNotMatch(providers, /\/api\/coding\/paas\/v4/);
  assert.match(providers, /FAL_MODEL_CONFIG_JSON/);
});

test("paid creative keeps provider routing and explicit spend approval", async () => {
  const actions = await source("app/studio/marketing-creative-actions.ts");
  assert.match(actions, /creativeProvider\(route\.request\.provider\)/);
  assert.match(actions, /estimated_cost_usd: quote\.usdEstimate/);
  const prepare = actions.indexOf("export async function prepareContentCreativeGeneration");
  const approve = actions.indexOf("export async function approvePreparedCreativeGeneration");
  const submit = actions.indexOf("provider.submit", approve);
  assert.ok(prepare >= 0 && approve > prepare && submit > approve);
  assert.doesNotMatch(actions.slice(prepare, approve), /provider\.submit/);
});

test("Studio explains preset model stacks, connections and price before spend", async () => {
  const page = await source("app/studio/(protected)/production/page.tsx");
  assert.match(page, /Generation quality/);
  assert.match(page, /Show exact route and price/);
  assert.match(page, /providerConnections/);
  assert.match(page, /quoteLabel\(quote\)/);
  assert.match(page, /Pricing anchors last verified/);
});

test("Vercel AI Gateway is the shared structured inference backbone", async () => {
  const gateway = await source("lib/ai/gateway.ts");
  assert.match(gateway, /https:\/\/ai-gateway\.vercel\.sh\/v1\/responses/);
  assert.match(gateway, /AI_GATEWAY_API_KEY/);
  assert.match(gateway, /VERCEL_OIDC_TOKEN/);
  assert.match(gateway, /providerOptions:\s*\{ gateway: gatewayOptions \}/);
  assert.match(gateway, /gatewayOptions\.models = fallbacks/);
  assert.match(gateway, /"cost" \| "ttft" \| "tps"/);
  assert.match(gateway, /estimatedCostUsd/);
  assert.match(gateway, /generationId/);
  assert.match(gateway, /inputTokens/);
  assert.match(gateway, /outputTokens/);
});

test("Atlas owns task routing above the Gateway", async () => {
  const tasks = await source("lib/ai/tasks.ts");
  const control = await source("lib/ai/control-plane.ts");
  assert.match(tasks, /marketing\.campaign_plan/);
  assert.match(tasks, /video\.concepts/);
  assert.match(tasks, /video\.production_plan/);
  assert.match(tasks, /video\.shot_revision/);
  assert.match(tasks, /ATLAS_MARKETING_ECONOMY_MODELS/);
  assert.match(tasks, /ATLAS_MARKETING_BALANCED_MODELS/);
  assert.match(tasks, /ATLAS_MARKETING_PREMIUM_MODELS/);
  assert.match(tasks, /VIDEO_DIRECTOR_LLM_MODEL/);
  assert.match(control, /runAtlasAiTask/);
  assert.match(control, /quality_escalation/);
  assert.match(control, /parent_run_id/);
  assert.match(control, /AtlasAiBudgetError/);
  assert.match(control, /AtlasAiQualityError/);
  assert.match(control, /generateGatewayStructured/);
});

test("marketing structured text uses Control Plane quality gates instead of provider clients", async () => {
  const ai = await source("lib/marketing/ai.ts");
  assert.match(ai, /runAtlasAiTask/);
  assert.match(ai, /marketing\.campaign_plan/);
  assert.match(ai, /campaignQualityGate/);
  assert.match(ai, /disconnected social platform/);
  assert.doesNotMatch(ai, /api\.openai\.com/);
  assert.doesNotMatch(ai, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(ai, /api\.z\.ai\/api\/paas\/v4\/chat/);
});

test("Video Creative Director uses Control Plane but creative media providers stay direct", async () => {
  const director = await source("lib/video-director/openai-director.ts");
  const providers = await source("lib/marketing/creative-providers.ts");
  assert.match(director, /runAtlasAiTask/);
  assert.match(director, /video\.concepts/);
  assert.match(director, /video\.production_plan/);
  assert.match(director, /video\.shot_revision/);
  assert.match(director, /conceptQualityGate/);
  assert.match(director, /planQualityGate/);
  assert.match(director, /atlasAiGatewayConfigured/);
  assert.doesNotMatch(director, /api\.openai\.com/);
  assert.match(providers, /https:\/\/api\.bfl\.ai\/v1/);
  assert.match(providers, /https:\/\/generativelanguage\.googleapis\.com\/v1beta/);
});
