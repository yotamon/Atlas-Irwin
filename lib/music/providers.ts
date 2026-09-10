import { miniMaxGenerationCost, type MusicGenerationInput } from "./generator";

export type GeneratedMusic = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength?: string;
  provider: "minimax" | "eleven";
  model: string;
  estimatedCostUsd: number;
  providerRequestId?: string;
};

class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

async function responseError(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const detail = json.detail ?? json.message ?? json.error ?? json.base_resp;
    return typeof detail === "string" ? detail : JSON.stringify(detail ?? json);
  } catch {
    return text.slice(0, 800);
  }
}

function looksLikeUnsupportedModel(error: unknown) {
  return error instanceof ProviderRequestError
    && [400, 404, 422].includes(error.status)
    && /model/i.test(error.message)
    && /(invalid|unsupported|unknown|not found|does not exist|available)/i.test(error.message);
}

function bytesStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function downloadAudioStream(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok || !response.body) {
    throw new ProviderRequestError(
      `Could not download generated audio: ${await responseError(response)}`,
      response.status || 502,
    );
  }
  return {
    body: response.body,
    contentType: response.headers.get("content-type") || "audio/mpeg",
    contentLength: response.headers.get("content-length") || undefined,
  };
}

async function generateMiniMaxWithModel(input: MusicGenerationInput, prompt: string, model: string): Promise<GeneratedMusic> {
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (!apiKey) throw new ProviderRequestError("MiniMax is not configured. Add MINIMAX_API_KEY.", 503);

  const payload: Record<string, unknown> = {
    model,
    prompt,
    is_instrumental: input.instrumental,
    stream: false,
    output_format: "url",
    audio_setting: {
      sample_rate: 44100,
      bitrate: 256000,
      format: "mp3",
    },
  };

  if (!input.instrumental) payload.lyrics = input.lyrics?.trim();

  const response = await fetch("https://api.minimax.io/v1/music_generation", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const data = await response.json().catch(() => null) as {
    data?: { audio?: string; status?: number };
    trace_id?: string;
    base_resp?: { status_code?: number; status_msg?: string };
  } | null;

  const providerStatus = data?.base_resp?.status_code ?? 0;
  if (!response.ok || providerStatus !== 0 || !data?.data?.audio) {
    const providerMessage = data?.base_resp?.status_msg;
    const message = providerMessage || (!response.ok
      ? `${response.status} ${response.statusText}`
      : "MiniMax did not return audio.");
    throw new ProviderRequestError(`MiniMax: ${message}`, response.ok ? 422 : response.status);
  }

  const audioValue = data.data.audio;
  let stream: { body: ReadableStream<Uint8Array>; contentType: string; contentLength?: string };
  if (/^https?:\/\//i.test(audioValue)) {
    stream = await downloadAudioStream(audioValue);
  } else {
    const bytes = new Uint8Array(Buffer.from(audioValue, "hex"));
    stream = {
      body: bytesStream(bytes),
      contentType: "audio/mpeg",
      contentLength: String(bytes.byteLength),
    };
  }

  return {
    ...stream,
    provider: "minimax",
    model,
    estimatedCostUsd: miniMaxGenerationCost(model),
    providerRequestId: data.trace_id,
  };
}

export async function generateMiniMax(input: MusicGenerationInput, prompt: string) {
  const preferredModel = process.env.MINIMAX_MUSIC_MODEL?.trim() || "music-2.6";
  const fallbackModel = process.env.MINIMAX_MUSIC_FALLBACK_MODEL?.trim();
  try {
    return await generateMiniMaxWithModel(input, prompt, preferredModel);
  } catch (error) {
    if (fallbackModel && preferredModel !== fallbackModel && looksLikeUnsupportedModel(error)) {
      return generateMiniMaxWithModel(input, prompt, fallbackModel);
    }
    throw error;
  }
}

async function elevenRequest(path: string, body: Record<string, unknown>) {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new ProviderRequestError("ElevenLabs is not configured. Add ELEVENLABS_API_KEY.", 503);

  return fetch(`https://api.elevenlabs.io${path}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export async function generateEleven(input: MusicGenerationInput, prompt: string): Promise<GeneratedMusic> {
  const model = process.env.ELEVENLABS_MUSIC_MODEL?.trim() || "music_v2";
  const durationMs = Math.round(input.durationSeconds * 1000);
  let generationBody: Record<string, unknown>;

  if (input.instrumental) {
    generationBody = {
      prompt,
      music_length_ms: durationMs,
      model_id: model,
      force_instrumental: true,
    };
  } else {
    const lyrics = input.lyrics?.trim() || "";
    const instruction = "Use this lyric structure and text faithfully:";
    const styleBudget = Math.max(350, 4050 - lyrics.length - instruction.length);
    const planPrompt = `${prompt.slice(0, styleBudget)}\n\n${instruction}\n${lyrics}`.slice(0, 4100);
    const planResponse = await elevenRequest("/v1/music/plan", {
      prompt: planPrompt,
      music_length_ms: durationMs,
      model_id: model,
    });
    if (!planResponse.ok) {
      throw new ProviderRequestError(`ElevenLabs plan: ${await responseError(planResponse)}`, planResponse.status);
    }
    const compositionPlan = await planResponse.json();
    generationBody = {
      composition_plan: compositionPlan,
      model_id: model,
    };
  }

  const response = await elevenRequest("/v1/music/stream?output_format=mp3_48000_192", generationBody);
  if (!response.ok || !response.body) {
    throw new ProviderRequestError(`ElevenLabs: ${await responseError(response)}`, response.status || 502);
  }

  return {
    body: response.body,
    contentType: response.headers.get("content-type") || "audio/mpeg",
    contentLength: response.headers.get("content-length") || undefined,
    provider: "eleven",
    model,
    estimatedCostUsd: 0.15 * (input.durationSeconds / 60),
    providerRequestId: response.headers.get("song-id") || undefined,
  };
}

export function providerErrorResponse(error: unknown) {
  if (error instanceof ProviderRequestError) {
    return { message: error.message, status: error.status };
  }
  return {
    message: error instanceof Error ? error.message : "Music generation failed.",
    status: 500,
  };
}
