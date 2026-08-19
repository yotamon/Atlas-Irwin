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

test("marketing structured text can route through ZAI Google and OpenAI", async () => {
  const ai = await source("lib/marketing/ai.ts");
  assert.match(ai, /glm-4\.7-flash/);
  assert.match(ai, /gemini-3\.7-flash/);
  assert.match(ai, /OPENAI_RESPONSES_URL/);
  assert.match(ai, /ATLAS_MARKETING_TEXT_PRESET/);
  assert.doesNotMatch(ai, /\/api\/coding\/paas\/v4/);
});
