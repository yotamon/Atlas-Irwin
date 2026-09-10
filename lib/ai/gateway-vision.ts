import "server-only";

import { headers as nextHeaders } from "next/headers";
import {
  AI_GATEWAY_RESPONSES_URL,
  gatewayProviderSort,
  normalizeGatewayModel,
  type AtlasGatewayProviderSort,
  type GatewayStructuredResult,
} from "./gateway";

type GatewayVisionPayload = {
  id?: string;
  model?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  usage?: unknown;
  error?: unknown;
  provider_metadata?: unknown;
  providerMetadata?: unknown;
  gateway?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function token() {
  const explicit = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
  if (explicit) return explicit;
  try {
    const requestHeaders = await nextHeaders();
    return requestHeaders.get("x-vercel-oidc-token")?.trim() || "";
  } catch {
    return "";
  }
}

function outputText(payload: GatewayVisionPayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal" && content.refusal) throw new Error(`AI Gateway visual reviewer refused the request: ${content.refusal}`);
      if (typeof content.text === "string" && content.text.trim()) return content.text;
    }
  }
  throw new Error("AI Gateway visual reviewer returned no structured output.");
}

function numeric(value: unknown) {
  const candidate = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
}

function integer(value: unknown) {
  const candidate = numeric(value);
  return candidate === null ? null : Math.round(candidate);
}

function metadataString(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function gatewayError(payload: GatewayVisionPayload, response: Response) {
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  const error = record(payload.error);
  if (typeof error.message === "string" && error.message.trim()) return error.message;
  return `${response.status} ${response.statusText}`.trim();
}

export async function generateGatewayVisionStructured<T>(input: {
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  prompt: string;
  imageUrls: string[];
  model: string;
  fallbackModels?: string[];
  providerSort?: AtlasGatewayProviderSort;
  timeoutMs?: number;
}): Promise<GatewayStructuredResult<T>> {
  const auth = await token();
  if (!auth) throw new Error("Vercel AI Gateway authentication is unavailable for visual quality review.");
  const requestedModel = normalizeGatewayModel(input.model);
  if (!requestedModel) throw new Error("Visual quality review model is not configured.");
  const imageUrls = Array.from(new Set(input.imageUrls.filter((url) => /^https:\/\//i.test(url)))).slice(0, 8);
  if (!imageUrls.length) throw new Error("Visual quality review requires at least one public HTTPS image.");
  const fallbackModels = Array.from(new Set((input.fallbackModels ?? [])
    .map((model) => normalizeGatewayModel(model))
    .filter((model) => model && model !== requestedModel)));
  const gatewayOptions: Record<string, unknown> = { sort: input.providerSort ?? gatewayProviderSort() };
  if (fallbackModels.length) gatewayOptions.models = fallbackModels;
  const requestId = crypto.randomUUID();

  const response = await fetch(AI_GATEWAY_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
      "X-Client-Request-Id": requestId,
      "x-title": "Atlas Irwin Creative QA",
    },
    body: JSON.stringify({
      model: requestedModel,
      store: false,
      instructions: input.instructions,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: input.prompt },
          ...imageUrls.map((imageUrl) => ({ type: "input_image", image_url: imageUrl, detail: "high" })),
        ],
      }],
      text: {
        verbosity: "medium",
        format: { type: "json_schema", name: input.name, strict: true, schema: input.schema },
      },
      providerOptions: { gateway: gatewayOptions },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(Math.max(15_000, Math.min(input.timeoutMs ?? 90_000, 180_000))),
  });
  const payload = await response.json().catch(() => ({})) as GatewayVisionPayload;
  if (!response.ok) throw new Error(`Vercel AI Gateway visual review failed (${response.status}): ${gatewayError(payload, response)}`);
  const raw = outputText(payload);
  let value: T;
  try { value = JSON.parse(raw) as T; }
  catch (error) { throw new Error(`Visual reviewer returned invalid structured JSON: ${error instanceof Error ? error.message : "unknown parse error"}`); }

  const gateway = record(record(payload.provider_metadata).gateway || record(payload.providerMetadata).gateway || payload.gateway);
  const routing = record(gateway.routing);
  const usage = record(payload.usage);
  return {
    value,
    model: typeof payload.model === "string" && payload.model.trim() ? payload.model : requestedModel,
    requestedModel,
    requestId: response.headers.get("x-request-id") || payload.id || requestId,
    generationId: metadataString(gateway, "generationId", "generation_id"),
    routedProvider: metadataString(routing, "finalProvider", "resolvedProvider", "final_provider", "resolved_provider"),
    estimatedCostUsd: numeric(gateway.cost),
    inputTokens: integer(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.promptTokens),
    outputTokens: integer(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? usage.completionTokens),
  };
}
