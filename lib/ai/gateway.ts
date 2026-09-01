import "server-only";

import { headers as nextHeaders } from "next/headers";

export const AI_GATEWAY_RESPONSES_URL = "https://ai-gateway.vercel.sh/v1/responses";

export type AtlasGatewayProviderSort = "cost" | "ttft" | "tps";

export type GatewayStructuredResult<T> = {
  value: T;
  model: string;
  requestedModel: string;
  requestId: string | null;
  generationId: string | null;
  routedProvider: string | null;
  estimatedCostUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

type GatewayResponsePayload = {
  id?: string;
  model?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  usage?: unknown;
  error?: unknown;
  provider_metadata?: unknown;
  providerMetadata?: unknown;
  gateway?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function envToken() {
  return process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim() || "";
}

async function gatewayToken() {
  const explicit = envToken();
  if (explicit) return explicit;

  try {
    const requestHeaders = await nextHeaders();
    return requestHeaders.get("x-vercel-oidc-token")?.trim() || "";
  } catch {
    return "";
  }
}

export function atlasAiGatewayConfigured() {
  return Boolean(envToken()) || Boolean(process.env.VERCEL);
}

export function normalizeGatewayModel(model: string, defaultProvider?: string) {
  const value = model.trim();
  if (!value) return "";
  if (value.includes("/")) return value;

  if (value === "gpt-5.6") return "openai/gpt-5.6-sol";
  if (value.startsWith("gpt-") || /^o\d/.test(value)) return `openai/${value}`;
  if (value.startsWith("gemini-")) return `google/${value}`;
  if (value.startsWith("glm-")) return `zai/${value}`;
  if (value.startsWith("claude-")) return `anthropic/${value}`;
  return defaultProvider ? `${defaultProvider}/${value}` : value;
}

export function parseGatewayModelList(value: string | null | undefined, defaultProvider?: string) {
  return Array.from(new Set(
    (value ?? "")
      .split(",")
      .map((model) => normalizeGatewayModel(model, defaultProvider))
      .filter(Boolean),
  ));
}

export function gatewayProviderSort(): AtlasGatewayProviderSort {
  const value = process.env.ATLAS_AI_GATEWAY_PROVIDER_SORT?.trim().toLowerCase();
  return value === "ttft" || value === "tps" ? value : "cost";
}

function requestTimeoutMs(override?: number) {
  if (override && Number.isFinite(override) && override >= 5_000) return Math.round(override);
  const configured = Number(process.env.ATLAS_AI_GATEWAY_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 5_000 && configured <= 300_000) return Math.round(configured);
  return 90_000;
}

function gatewayError(payload: GatewayResponsePayload, response: Response) {
  const error = payload.error;
  if (typeof error === "string" && error.trim()) return error;
  const record = asRecord(error);
  if (record) {
    const message = record.message;
    if (typeof message === "string" && message.trim()) return message;
    try { return JSON.stringify(record).slice(0, 900); }
    catch { /* fall through */ }
  }
  return `${response.status} ${response.statusText}`.trim();
}

function outputText(payload: GatewayResponsePayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal" && content.refusal) {
        throw new Error(`AI Gateway model refused the request: ${content.refusal}`);
      }
      if (typeof content.text === "string" && content.text.trim()) return content.text;
    }
  }
  throw new Error("AI Gateway returned no structured output.");
}

function gatewayMetadata(payload: GatewayResponsePayload) {
  const metadata = asRecord(payload.provider_metadata) ?? asRecord(payload.providerMetadata);
  return asRecord(metadata?.gateway) ?? asRecord(payload.gateway) ?? {};
}

function numeric(value: unknown) {
  const result = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function integer(value: unknown) {
  const result = numeric(value);
  return result === null ? null : Math.round(result);
}

function metadataString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function usageTokens(payload: GatewayResponsePayload) {
  const usage = asRecord(payload.usage) ?? {};
  return {
    inputTokens: integer(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.promptTokens),
    outputTokens: integer(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? usage.completionTokens),
  };
}

export async function generateGatewayStructured<T>({
  name,
  schema,
  instructions,
  input,
  model,
  fallbackModels = [],
  timeoutMs,
  providerSort,
}: {
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: string;
  model: string;
  fallbackModels?: string[];
  timeoutMs?: number;
  providerSort?: AtlasGatewayProviderSort;
}): Promise<GatewayStructuredResult<T>> {
  const token = await gatewayToken();
  if (!token) {
    throw new Error(
      "Vercel AI Gateway authentication is unavailable. On Vercel, enable Secure Backend Access with OIDC Federation; otherwise set AI_GATEWAY_API_KEY.",
    );
  }

  const requestedModel = normalizeGatewayModel(model);
  if (!requestedModel) throw new Error("AI Gateway model is not configured.");

  const fallbacks = Array.from(new Set(
    fallbackModels
      .map((candidate) => normalizeGatewayModel(candidate))
      .filter((candidate) => candidate && candidate !== requestedModel),
  ));
  const clientRequestId = crypto.randomUUID();
  const gatewayOptions: Record<string, unknown> = { sort: providerSort ?? gatewayProviderSort() };
  if (fallbacks.length) gatewayOptions.models = fallbacks;

  const requestHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Client-Request-Id": clientRequestId,
    "x-title": "Atlas Irwin",
  };
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (siteUrl?.startsWith("https://") || siteUrl?.startsWith("http://")) requestHeaders["http-referer"] = siteUrl;

  let response: Response;
  try {
    response = await fetch(AI_GATEWAY_RESPONSES_URL, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        model: requestedModel,
        store: false,
        instructions,
        input,
        text: {
          verbosity: "medium",
          format: { type: "json_schema", name, strict: true, schema },
        },
        providerOptions: { gateway: gatewayOptions },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeoutMs(timeoutMs)),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`Vercel AI Gateway request timed out for ${requestedModel}.`);
    }
    throw new Error(`Vercel AI Gateway network request failed: ${error instanceof Error ? error.message : "unknown network error"}`);
  }

  const payload = await response.json().catch(() => ({})) as GatewayResponsePayload;
  if (!response.ok) {
    throw new Error(`Vercel AI Gateway request failed (${response.status}): ${gatewayError(payload, response)}`);
  }

  const text = outputText(payload);
  let value: T;
  try { value = JSON.parse(text) as T; }
  catch (error) {
    throw new Error(`Vercel AI Gateway returned invalid structured JSON: ${error instanceof Error ? error.message : "unknown parse error"}`);
  }

  const gateway = gatewayMetadata(payload);
  const routing = asRecord(gateway.routing) ?? {};
  const usage = usageTokens(payload);
  return {
    value,
    model: typeof payload.model === "string" && payload.model.trim() ? payload.model : requestedModel,
    requestedModel,
    requestId: response.headers.get("x-request-id") || payload.id || clientRequestId,
    generationId: metadataString(gateway, "generationId", "generation_id"),
    routedProvider: metadataString(routing, "finalProvider", "resolvedProvider", "final_provider", "resolved_provider"),
    estimatedCostUsd: numeric(gateway.cost),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}
