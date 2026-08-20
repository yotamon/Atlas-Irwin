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
});

test("marketing structured text routes through Gateway with Atlas-owned presets", async () => {
  const ai = await source("lib/marketing/ai.ts");
  assert.match(ai, /generateGatewayStructured/);
  assert.match(ai, /zai\/glm-4\.7-flash/);
  assert.match(ai, /google\/gemini-3\.7-flash/);
  assert.match(ai, /openai\/gpt-5\.6-sol/);
  assert.match(ai, /ATLAS_MARKETING_TEXT_PRESET/);
  assert.match(ai, /ATLAS_MARKETING_ECONOMY_MODELS/);
  assert.match(ai, /ATLAS_MARKETING_BALANCED_MODELS/);
  assert.match(ai, /ATLAS_MARKETING_PREMIUM_MODELS/);
  assert.doesNotMatch(ai, /api\.openai\.com/);
  assert.doesNotMatch(ai, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(ai, /api\.z\.ai\/api\/paas\/v4\/chat/);
});

test("Video Creative Director uses the shared Gateway but creative media providers stay direct", async () => {
  const director = await source("lib/video-director/openai-director.ts");
  const providers = await source("lib/marketing/creative-providers.ts");
  assert.match(director, /generateGatewayStructured/);
  assert.match(director, /VIDEO_DIRECTOR_LLM_FALLBACK_MODELS/);
  assert.match(director, /atlasAiGatewayConfigured/);
  assert.doesNotMatch(director, /api\.openai\.com/);
  assert.match(providers, /https:\/\/api\.bfl\.ai\/v1/);
  assert.match(providers, /https:\/\/generativelanguage\.googleapis\.com\/v1beta/);
});
