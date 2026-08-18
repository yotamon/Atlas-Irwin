import "server-only";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export type StructuredGenerationResult<T> = {
  value: T;
  provider: "openai";
  model: string;
  requestId: string | null;
};

function outputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as {
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

export function marketingAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function marketingAiModel() {
  return process.env.ATLAS_MARKETING_MODEL?.trim() || "gpt-5.6";
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
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const model = marketingAiModel();
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
      instructions,
      input,
      text: {
        verbosity: "medium",
        format: {
          type: "json_schema",
          name,
          strict: true,
          schema,
        },
      },
    }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body
      ? JSON.stringify((body as { error: unknown }).error)
      : `${response.status} ${response.statusText}`;
    throw new Error(`Marketing AI request failed: ${message}`);
  }
  const text = outputText(body);
  if (!text) throw new Error("Marketing AI returned no structured output.");
  try {
    return {
      value: JSON.parse(text) as T,
      provider: "openai",
      model,
      requestId: response.headers.get("x-request-id"),
    };
  } catch {
    throw new Error("Marketing AI returned invalid JSON.");
  }
}
