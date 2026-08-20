import "server-only";

import {
  atlasAiGatewayConfigured,
  generateGatewayStructured,
  normalizeGatewayModel,
  parseGatewayModelList,
} from "@/lib/ai/gateway";

export type MarketingTextProvider = "vercel-gateway" | "openai" | "google" | "zai";
export type MarketingTextPreset = "economy" | "balanced" | "premium";

export type StructuredGenerationResult<T> = {
  value: T;
  provider: MarketingTextProvider;
  model: string;
  requestId: string | null;
  estimatedCostUsd: number | null;
  generationId?: string | null;
  routedProvider?: string | null;
};

function textPreset(): MarketingTextPreset {
  const value = process.env.ATLAS_MARKETING_TEXT_PRESET?.trim().toLowerCase();
  return value === "economy" || value === "premium" ? value : "balanced";
}

function premiumOpenAiModel() {
  return normalizeGatewayModel(process.env.ATLAS_MARKETING_MODEL?.trim() || "openai/gpt-5.6-sol", "openai");
}

function configuredRoute(name: string, fallback: string[]) {
  const models = parseGatewayModelList(process.env[name]);
  return models.length ? models : fallback;
}

function marketingTextRoute(preset: MarketingTextPreset) {
  const premium = premiumOpenAiModel();
  if (preset === "economy") {
    return configuredRoute("ATLAS_MARKETING_ECONOMY_MODELS", [
      "zai/glm-4.7-flash",
      "zai/glm-4.7-flashx",
      "google/gemini-3.7-flash",
      premium,
    ]);
  }
  if (preset === "premium") {
    return configuredRoute("ATLAS_MARKETING_PREMIUM_MODELS", [
      premium,
      "google/gemini-3.7-flash",
      "zai/glm-4.7-flashx",
    ]);
  }
  return configuredRoute("ATLAS_MARKETING_BALANCED_MODELS", [
    "google/gemini-3.7-flash",
    premium,
    "zai/glm-4.7-flashx",
  ]);
}

export function marketingAiConfigured() {
  return atlasAiGatewayConfigured();
}

export function marketingAiModel() {
  return marketingTextRoute(textPreset())[0] ?? "google/gemini-3.7-flash";
}

export async function generateStructured<T>({
  name,
  schema,
  instructions,
  input,
}: {
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: string;
}): Promise<StructuredGenerationResult<T>> {
  if (!marketingAiConfigured()) {
    throw new Error(
      "Atlas marketing AI is not configured. Production uses Vercel OIDC automatically; set AI_GATEWAY_API_KEY for local development.",
    );
  }

  const route = marketingTextRoute(textPreset());
  const [model, ...fallbackModels] = route;
  if (!model) throw new Error("Atlas marketing AI has no configured Gateway model route.");

  const result = await generateGatewayStructured<T>({
    name,
    schema,
    instructions,
    input,
    model,
    fallbackModels,
  });

  return {
    value: result.value,
    provider: "vercel-gateway",
    model: result.model,
    requestId: result.requestId,
    estimatedCostUsd: result.estimatedCostUsd,
    generationId: result.generationId,
    routedProvider: result.routedProvider,
  };
}
