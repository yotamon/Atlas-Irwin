import "server-only";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const GOOGLE_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const ZAI_CHAT_URL = "https://api.z.ai/api/paas/v4/chat/completions";

export type MarketingTextProvider = "openai" | "google" | "zai";
export type MarketingTextPreset = "economy" | "balanced" | "premium";

export type StructuredGenerationResult<T> = {
  value: T;
  provider: MarketingTextProvider;
  model: string;
  requestId: string | null;
  estimatedCostUsd: number | null;
};

function outputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as {
    output_text?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

function parseJson<T>(text: string, provider: string) {
  if (!text) throw new Error(`${provider} returned no structured output.`);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`${provider} returned invalid JSON.`); }
}

function textPreset(): MarketingTextPreset {
  const value = process.env.ATLAS_MARKETING_TEXT_PRESET?.trim().toLowerCase();
  return value === "economy" || value === "premium" ? value : "balanced";
}

export function marketingAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || process.env.ZAI_API_KEY?.trim());
}

export function marketingAiModel() {
  const preset = textPreset();
  if (preset === "economy" && process.env.ZAI_API_KEY?.trim()) return "glm-4.7-flash";
  if (preset === "balanced" && process.env.GEMINI_API_KEY?.trim()) return "gemini-3.7-flash";
  if (preset === "premium" && process.env.OPENAI_API_KEY?.trim()) return process.env.ATLAS_MARKETING_MODEL?.trim() || "gpt-5.6";
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini-3.7-flash";
  if (process.env.OPENAI_API_KEY?.trim()) return process.env.ATLAS_MARKETING_MODEL?.trim() || "gpt-5.6";
  return "glm-4.7-flashx";
}

async function callOpenAI<T>(input: {
  name: string;
  schema: Record<string, unknown>;
  instructions: string;
  prompt: string;
}): Promise<StructuredGenerationResult<T>> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const model = process.env.ATLAS_MARKETING_MODEL?.trim() || "gpt-5.6";
  const clientRequestId = crypto.randomUUID();
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Client-Request-Id": clientRequestId,
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: input.instructions,
      input: input.prompt,
      text: {
        verbosity: "medium",
        format: { type: "json_schema", name: input.name, strict: true, schema: input.schema },
      },
    }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body
      ? JSON.stringify((body as { error: unknown }).error)
      : `${response.status} ${response.statusText}`;
    throw new Error(`OpenAI marketing request failed: ${message}`);
  }
  return {
    value: parseJson<T>(outputText(body), "OpenAI"),
    provider: "openai",
    model,
    requestId: response.headers.get("x-request-id"),
    estimatedCostUsd: null,
  };
}

async function callGoogle<T>(input: {
  schema: Record<string, unknown>;
  instructions: string;
  prompt: string;
}): Promise<StructuredGenerationResult<T>> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
  const model = "gemini-3.7-flash";
  const response = await fetch(GOOGLE_INTERACTIONS_URL, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: `${input.instructions}\n\nTASK INPUT:\n${input.prompt}`,
      response_format: { type: "text", mime_type: "application/json", schema: input.schema },
    }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as { output_text?: string; id?: string; error?: unknown } | null;
  if (!response.ok) throw new Error(`Gemini marketing request failed (${response.status}): ${JSON.stringify(body?.error ?? body).slice(0, 700)}`);
  return {
    value: parseJson<T>(body?.output_text || "", "Gemini"),
    provider: "google",
    model,
    requestId: response.headers.get("x-request-id") || body?.id || null,
    estimatedCostUsd: null,
  };
}

async function callZai<T>(input: {
  schema: Record<string, unknown>;
  instructions: string;
  prompt: string;
  model: "glm-4.7-flash" | "glm-4.7-flashx";
}): Promise<StructuredGenerationResult<T>> {
  const apiKey = process.env.ZAI_API_KEY?.trim();
  if (!apiKey) throw new Error("ZAI_API_KEY is not configured.");
  const response = await fetch(ZAI_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: `${input.instructions}\nReturn one valid JSON object matching this schema exactly:\n${JSON.stringify(input.schema)}` },
        { role: "user", content: input.prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as {
    id?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: unknown;
  } | null;
  if (!response.ok) throw new Error(`Z.AI marketing request failed (${response.status}): ${JSON.stringify(body?.error ?? body).slice(0, 700)}`);
  const text = body?.choices?.[0]?.message?.content || "";
  const usage = body?.usage;
  const estimatedCostUsd = input.model === "glm-4.7-flash"
    ? 0
    : usage
      ? Number((((usage.prompt_tokens ?? 0) * 0.07 + (usage.completion_tokens ?? 0) * 0.40) / 1_000_000).toFixed(6))
      : null;
  return {
    value: parseJson<T>(text, "Z.AI"),
    provider: "zai",
    model: input.model,
    requestId: response.headers.get("x-request-id") || body?.id || null,
    estimatedCostUsd,
  };
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
  if (!marketingAiConfigured()) throw new Error("No Atlas marketing text provider is configured.");
  const preset = textPreset();
  const attempts: Array<() => Promise<StructuredGenerationResult<T>>> = preset === "economy"
    ? [
        () => callZai<T>({ schema, instructions, prompt: input, model: "glm-4.7-flash" }),
        () => callZai<T>({ schema, instructions, prompt: input, model: "glm-4.7-flashx" }),
        () => callGoogle<T>({ schema, instructions, prompt: input }),
        () => callOpenAI<T>({ name, schema, instructions, prompt: input }),
      ]
    : preset === "premium"
      ? [
          () => callOpenAI<T>({ name, schema, instructions, prompt: input }),
          () => callGoogle<T>({ schema, instructions, prompt: input }),
          () => callZai<T>({ schema, instructions, prompt: input, model: "glm-4.7-flashx" }),
        ]
      : [
          () => callGoogle<T>({ schema, instructions, prompt: input }),
          () => callOpenAI<T>({ name, schema, instructions, prompt: input }),
          () => callZai<T>({ schema, instructions, prompt: input, model: "glm-4.7-flashx" }),
        ];

  const errors: string[] = [];
  for (const attempt of attempts) {
    try { return await attempt(); }
    catch (error) {
      const message = error instanceof Error ? error.message : "unknown provider error";
      if (message.includes("is not configured")) continue;
      errors.push(message);
    }
  }
  throw new Error(`All configured Atlas marketing text routes failed. ${errors.join(" | ")}`);
}
