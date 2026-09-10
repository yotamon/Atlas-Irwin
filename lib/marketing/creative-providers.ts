import "server-only";

import { HiggsfieldProvider, higgsfieldReadiness, isHiggsfieldDefiniteRejection } from "@/lib/video-providers/higgsfield/client";
import type { VideoGenerationRequest, VideoProviderMedia } from "@/lib/video-providers/types";
import { officialUsdAnchor } from "./creative-provider-catalog";
import type {
  CreativeGenerationProvider,
  CreativeGenerationRequest,
  CreativeMoneyQuote,
  CreativeProviderId,
  CreativeProviderReadiness,
  CreativeProviderStatus,
} from "./creative-provider-types";

const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";
const ZAI_BASE = "https://api.z.ai/api/paas/v4";
const BFL_BASE = "https://api.bfl.ai/v1";

export class CreativeProviderRequestError extends Error {
  readonly definitelyNotSubmitted: boolean;
  readonly provider: CreativeProviderId;

  constructor(provider: CreativeProviderId, message: string, definitelyNotSubmitted: boolean) {
    super(message);
    this.name = "CreativeProviderRequestError";
    this.provider = provider;
    this.definitelyNotSubmitted = definitelyNotSubmitted;
  }
}

export function isCreativeDefiniteRejection(error: unknown) {
  return (error instanceof CreativeProviderRequestError && error.definitelyNotSubmitted) || isHiggsfieldDefiniteRejection(error);
}

function key(name: string, provider: CreativeProviderId) {
  const value = process.env[name]?.trim();
  if (!value) throw new CreativeProviderRequestError(provider, `${name} is not configured.`, true);
  return value;
}

function quoteFromAnchor(request: CreativeGenerationRequest): CreativeMoneyQuote {
  const anchor = officialUsdAnchor({
    provider: request.provider,
    model: request.model,
    outputKind: request.operation === "look_image" ? "image" : "video",
    resolution: request.resolution,
    durationSeconds: request.durationSeconds,
    referenceCount: request.medias?.filter((media) => media.role === "image" || media.role === "start_image" || media.role === "end_image").length ?? 0,
  });
  if (!anchor) throw new Error(`No transparent price anchor is configured for ${request.provider}/${request.model}.`);
  return {
    currency: "USD",
    amount: anchor.amount,
    reserveAmount: Number((anchor.amount * (anchor.exact ? 1 : 1.2)).toFixed(4)),
    exact: anchor.exact,
    source: "official_price_anchor",
    note: anchor.note,
    usdEstimate: anchor.amount,
  };
}

async function safeJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function remoteImage(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load creative reference (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 12 * 1024 * 1024) throw new Error("Creative reference is empty or too large for provider upload.");
  return {
    data: buffer.toString("base64"),
    mimeType: response.headers.get("content-type")?.split(";")[0] || "image/jpeg",
  };
}

function aspectDimensions(ratio: string, resolution: string) {
  const long = resolution === "4k" ? 3072 : resolution === "1080p" ? 2048 : 1024;
  if (ratio === "9:16") return { width: Math.round(long * 9 / 16), height: long };
  if (ratio === "16:9") return { width: long, height: Math.round(long * 9 / 16) };
  return { width: long, height: long };
}

function imageMedias(request: CreativeGenerationRequest) {
  return (request.medias ?? []).filter((media) => ["image", "start_image", "end_image"].includes(media.role));
}

class BflProvider implements CreativeGenerationProvider {
  readonly id = "bfl" as const;

  async quote(request: CreativeGenerationRequest) { return quoteFromAnchor(request); }

  async submit(request: CreativeGenerationRequest): Promise<CreativeProviderStatus> {
    const apiKey = key("BFL_API_KEY", this.id);
    if (request.operation !== "look_image") throw new CreativeProviderRequestError(this.id, "BFL route currently supports image generation only.", true);
    const allowed = new Set(["flux-2-klein-4b", "flux-2-pro-preview", "flux-2-max"]);
    if (!allowed.has(request.model)) throw new CreativeProviderRequestError(this.id, `Unverified BFL model endpoint: ${request.model}.`, true);
    const dimensions = aspectDimensions(request.aspectRatio, request.resolution);
    const refs = imageMedias(request).slice(0, request.model === "flux-2-klein-4b" ? 4 : 8);
    const body: Record<string, unknown> = { prompt: request.prompt, ...dimensions };
    refs.forEach((media, index) => { body[index === 0 ? "input_image" : `input_image_${index + 1}`] = media.url; });
    let response: Response;
    try {
      response = await fetch(`${BFL_BASE}/${request.model}`, {
        method: "POST",
        headers: { "x-key": apiKey, accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
    } catch (error) {
      throw new CreativeProviderRequestError(this.id, `BFL network request failed: ${error instanceof Error ? error.message : "network error"}. Submission state is ambiguous.`, false);
    }
    const payload = await safeJson(response);
    if (!response.ok) throw new CreativeProviderRequestError(this.id, `BFL rejected the request (${response.status}): ${JSON.stringify(payload).slice(0, 700)}`, response.status >= 400 && response.status < 500);
    const pollingUrl = typeof payload.polling_url === "string" ? payload.polling_url : "";
    if (!pollingUrl) throw new CreativeProviderRequestError(this.id, "BFL accepted the request without a polling URL. Submission state is ambiguous.", false);
    return { requestId: pollingUrl, status: "queued", raw: payload };
  }

  async status(requestId: string): Promise<CreativeProviderStatus> {
    const apiKey = key("BFL_API_KEY", this.id);
    if (!requestId.startsWith("https://")) throw new Error("Invalid stored BFL polling URL.");
    const response = await fetch(requestId, { headers: { "x-key": apiKey, accept: "application/json" }, cache: "no-store" });
    const payload = await safeJson(response);
    if (!response.ok) throw new Error(`BFL status request failed (${response.status}).`);
    const state = typeof payload.status === "string" ? payload.status : "Pending";
    const result = payload.result && typeof payload.result === "object" && !Array.isArray(payload.result) ? payload.result as Record<string, unknown> : {};
    if (state === "Ready") return { requestId, status: "completed", resultUrl: typeof result.sample === "string" ? result.sample : undefined, raw: payload };
    if (state === "Error" || state === "Failed") return { requestId, status: "failed", raw: payload };
    return { requestId, status: "in_progress", raw: payload };
  }
}

function googleImageSize(request: CreativeGenerationRequest) {
  if (request.model === "gemini-3.1-flash-lite-image") return "1K";
  return request.resolution === "4k" ? "4K" : request.resolution === "720p" ? "1K" : "2K";
}

async function googleImageParts(request: CreativeGenerationRequest) {
  const refs = imageMedias(request).slice(0, request.model === "gemini-3.1-flash-image" ? 10 : 3);
  const images = await Promise.all(refs.map((media) => remoteImage(media.url)));
  return [
    { text: request.prompt },
    ...images.map((image) => ({ inlineData: { data: image.data, mimeType: image.mimeType } })),
  ];
}

function inlineImageFromGoogle(payload: Record<string, unknown>) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as Record<string, unknown>).content;
    if (!content || typeof content !== "object" || Array.isArray(content)) continue;
    const parts = Array.isArray((content as Record<string, unknown>).parts) ? (content as Record<string, unknown>).parts as unknown[] : [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const inline = (part as Record<string, unknown>).inlineData;
      if (!inline || typeof inline !== "object" || Array.isArray(inline)) continue;
      const record = inline as Record<string, unknown>;
      if (typeof record.data === "string") return { data: record.data, mimeType: typeof record.mimeType === "string" ? record.mimeType : "image/png" };
    }
  }
  return null;
}

class GoogleProvider implements CreativeGenerationProvider {
  readonly id = "google" as const;

  async quote(request: CreativeGenerationRequest) { return quoteFromAnchor(request); }

  async submit(request: CreativeGenerationRequest): Promise<CreativeProviderStatus> {
    const apiKey = key("GEMINI_API_KEY", this.id);
    if (request.operation === "look_image") {
      const allowed = new Set(["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image"]);
      if (!allowed.has(request.model)) throw new CreativeProviderRequestError(this.id, `Unverified Google image model: ${request.model}.`, true);
      const parts = await googleImageParts(request);
      const response = await fetch(`${GOOGLE_BASE}/models/${request.model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: request.aspectRatio, imageSize: googleImageSize(request) },
          },
        }),
        cache: "no-store",
      });
      const payload = await safeJson(response);
      if (!response.ok) throw new CreativeProviderRequestError(this.id, `Google image generation failed (${response.status}): ${JSON.stringify(payload).slice(0, 700)}`, true);
      const image = inlineImageFromGoogle(payload);
      if (!image) throw new CreativeProviderRequestError(this.id, "Google returned success without image data.", false);
      return { requestId: crypto.randomUUID(), status: "completed", resultBase64: image.data, resultMimeType: image.mimeType, raw: payload };
    }

    const allowed = new Set(["veo-3.1-lite-generate-preview", "veo-3.1-fast-generate-preview"]);
    if (!allowed.has(request.model)) throw new CreativeProviderRequestError(this.id, `Unverified Google video model: ${request.model}.`, true);
    const first = imageMedias(request)[0];
    const reference = first ? await remoteImage(first.url) : null;
    const instance: Record<string, unknown> = { prompt: request.prompt };
    if (reference) instance.image = { bytesBase64Encoded: reference.data, mimeType: reference.mimeType };
    const response = await fetch(`${GOOGLE_BASE}/models/${request.model}:predictLongRunning`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [instance],
        parameters: { aspectRatio: request.aspectRatio, resolution: request.resolution === "4k" ? "1080p" : request.resolution, durationSeconds: 8, sampleCount: 1 },
      }),
      cache: "no-store",
    });
    const payload = await safeJson(response);
    if (!response.ok) throw new CreativeProviderRequestError(this.id, `Google Veo request failed (${response.status}): ${JSON.stringify(payload).slice(0, 700)}`, response.status >= 400 && response.status < 500);
    const operation = typeof payload.name === "string" ? payload.name : "";
    if (!operation) throw new CreativeProviderRequestError(this.id, "Google accepted the video request without an operation name. Submission state is ambiguous.", false);
    return { requestId: operation, status: "queued", raw: payload };
  }

  async status(requestId: string, request: CreativeGenerationRequest): Promise<CreativeProviderStatus> {
    const apiKey = key("GEMINI_API_KEY", this.id);
    if (request.operation === "look_image") throw new Error("Google image generations complete synchronously and do not need polling.");
    const response = await fetch(`${GOOGLE_BASE}/${requestId.replace(/^\//, "")}`, { headers: { "x-goog-api-key": apiKey }, cache: "no-store" });
    const payload = await safeJson(response);
    if (!response.ok) throw new Error(`Google generation status failed (${response.status}).`);
    if (payload.error) return { requestId, status: "failed", raw: payload };
    if (payload.done !== true) return { requestId, status: "in_progress", raw: payload };
    const responseValue = payload.response && typeof payload.response === "object" && !Array.isArray(payload.response) ? payload.response as Record<string, unknown> : {};
    const generate = responseValue.generateVideoResponse && typeof responseValue.generateVideoResponse === "object" && !Array.isArray(responseValue.generateVideoResponse) ? responseValue.generateVideoResponse as Record<string, unknown> : responseValue;
    const samples = Array.isArray(generate.generatedSamples) ? generate.generatedSamples : Array.isArray(generate.generatedVideos) ? generate.generatedVideos : [];
    const first = samples[0] && typeof samples[0] === "object" ? samples[0] as Record<string, unknown> : {};
    const video = first.video && typeof first.video === "object" && !Array.isArray(first.video) ? first.video as Record<string, unknown> : {};
    const uri = typeof video.uri === "string" ? video.uri : typeof video.url === "string" ? video.url : "";
    if (!uri) return { requestId, status: "failed", raw: payload };
    return { requestId, status: "completed", resultUrl: uri, resultFetchHeaders: { "x-goog-api-key": apiKey }, raw: payload };
  }
}

class ZaiProvider implements CreativeGenerationProvider {
  readonly id = "zai" as const;

  async quote(request: CreativeGenerationRequest) { return quoteFromAnchor(request); }

  async submit(request: CreativeGenerationRequest): Promise<CreativeProviderStatus> {
    const apiKey = key("ZAI_API_KEY", this.id);
    if (!request.model.startsWith("vidu2-")) throw new CreativeProviderRequestError(this.id, `Unsupported Z.AI creative model: ${request.model}.`, true);
    const refs = imageMedias(request);
    if (!refs.length) throw new CreativeProviderRequestError(this.id, "Vidu 2 Economy requires at least one release or brand image reference.", true);
    const model = request.model === "vidu2-reference" ? "vidu2-reference" : "vidu2-image";
    const body: Record<string, unknown> = {
      model,
      image_url: model === "vidu2-reference" ? refs.slice(0, 3).map((media) => media.url) : refs[0].url,
      prompt: request.prompt,
      duration: 4,
      size: request.aspectRatio === "9:16" ? "720x1280" : request.aspectRatio === "1:1" ? "720x720" : "1280x720",
      movement_amplitude: "auto",
      with_audio: false,
    };
    const response = await fetch(`${ZAI_BASE}/videos/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const payload = await safeJson(response);
    if (!response.ok) throw new CreativeProviderRequestError(this.id, `Z.AI Vidu request failed (${response.status}): ${JSON.stringify(payload).slice(0, 700)}`, response.status >= 400 && response.status < 500);
    const id = typeof payload.id === "string" ? payload.id : typeof payload.id === "number" ? String(payload.id) : "";
    if (!id) throw new CreativeProviderRequestError(this.id, "Z.AI accepted the request without a task id. Submission state is ambiguous.", false);
    return { requestId: id, status: "queued", raw: payload };
  }

  async status(requestId: string): Promise<CreativeProviderStatus> {
    const apiKey = key("ZAI_API_KEY", this.id);
    const response = await fetch(`${ZAI_BASE}/async-result/${encodeURIComponent(requestId)}`, { headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store" });
    const payload = await safeJson(response);
    if (!response.ok) throw new Error(`Z.AI generation status failed (${response.status}).`);
    const state = typeof payload.task_status === "string" ? payload.task_status : "PROCESSING";
    if (state === "FAIL") return { requestId, status: "failed", raw: payload };
    if (state !== "SUCCESS") return { requestId, status: "in_progress", raw: payload };
    const videos = Array.isArray(payload.video_result) ? payload.video_result : [];
    const first = videos[0] && typeof videos[0] === "object" ? videos[0] as Record<string, unknown> : {};
    return { requestId, status: typeof first.url === "string" ? "completed" : "failed", resultUrl: typeof first.url === "string" ? first.url : undefined, raw: payload };
  }
}

type FalModelConfig = { endpoint: string; price_per_second?: number; price_per_generation?: number; input_mode?: "image_to_video" | "text_to_video" | "image" };

function falConfig() {
  const raw = process.env.FAL_MODEL_CONFIG_JSON?.trim();
  if (!raw) return {} as Record<string, FalModelConfig>;
  try {
    const parsed = JSON.parse(raw) as Record<string, FalModelConfig>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { throw new Error("FAL_MODEL_CONFIG_JSON must be valid JSON."); }
}

class FalProvider implements CreativeGenerationProvider {
  readonly id = "fal" as const;

  async quote(request: CreativeGenerationRequest): Promise<CreativeMoneyQuote> {
    const config = falConfig()[request.model];
    if (!config) throw new Error(`No explicit fal configuration exists for ${request.model}.`);
    const amount = typeof config.price_per_generation === "number"
      ? config.price_per_generation
      : typeof config.price_per_second === "number"
        ? config.price_per_second * Math.max(1, request.durationSeconds ?? 5)
        : null;
    if (amount === null) throw new Error(`fal pricing is missing for ${request.model}; Atlas will not show an invented estimate.`);
    return { currency: "USD", amount: Number(amount.toFixed(4)), reserveAmount: Number((amount * 1.1).toFixed(4)), exact: false, source: "configured", note: "Configured fal marketplace price anchor. Update it when the selected marketplace model changes price.", usdEstimate: Number(amount.toFixed(4)) };
  }

  async submit(request: CreativeGenerationRequest, webhookUrl?: string): Promise<CreativeProviderStatus> {
    const apiKey = key("FAL_KEY", this.id);
    const config = falConfig()[request.model];
    if (!config?.endpoint) throw new CreativeProviderRequestError(this.id, `No verified fal endpoint is configured for ${request.model}.`, true);
    const endpoint = config.endpoint.replace(/^\/+/, "");
    const first = imageMedias(request)[0];
    const input: Record<string, unknown> = { prompt: request.prompt, aspect_ratio: request.aspectRatio };
    if (first && config.input_mode !== "text_to_video") input.image_url = first.url;
    if (request.operation !== "look_image") input.duration = Math.max(1, request.durationSeconds ?? 5);
    const suffix = webhookUrl ? `?fal_webhook=${encodeURIComponent(webhookUrl)}` : "";
    const response = await fetch(`https://queue.fal.run/${endpoint}${suffix}`, {
      method: "POST",
      headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    const payload = await safeJson(response);
    if (!response.ok) throw new CreativeProviderRequestError(this.id, `fal request failed (${response.status}): ${JSON.stringify(payload).slice(0, 700)}`, response.status >= 400 && response.status < 500);
    const requestId = typeof payload.request_id === "string" ? payload.request_id : "";
    if (!requestId) throw new CreativeProviderRequestError(this.id, "fal accepted the request without request_id. Submission state is ambiguous.", false);
    return { requestId, status: "queued", raw: payload };
  }

  async status(requestId: string, request: CreativeGenerationRequest): Promise<CreativeProviderStatus> {
    const apiKey = key("FAL_KEY", this.id);
    const config = falConfig()[request.model];
    if (!config?.endpoint) throw new Error(`No fal endpoint is configured for ${request.model}.`);
    const endpoint = config.endpoint.replace(/^\/+/, "");
    const statusResponse = await fetch(`https://queue.fal.run/${endpoint}/requests/${encodeURIComponent(requestId)}/status`, { headers: { Authorization: `Key ${apiKey}` }, cache: "no-store" });
    const statusPayload = await safeJson(statusResponse);
    if (!statusResponse.ok) throw new Error(`fal status request failed (${statusResponse.status}).`);
    const state = typeof statusPayload.status === "string" ? statusPayload.status : "IN_QUEUE";
    if (state === "IN_QUEUE" || state === "IN_PROGRESS") return { requestId, status: "in_progress", raw: statusPayload };
    if (state !== "COMPLETED") return { requestId, status: "failed", raw: statusPayload };
    const resultResponse = await fetch(`https://queue.fal.run/${endpoint}/requests/${encodeURIComponent(requestId)}`, { headers: { Authorization: `Key ${apiKey}` }, cache: "no-store" });
    const payload = await safeJson(resultResponse);
    if (!resultResponse.ok) throw new Error(`fal result request failed (${resultResponse.status}).`);
    const video = payload.video && typeof payload.video === "object" && !Array.isArray(payload.video) ? payload.video as Record<string, unknown> : {};
    const image = payload.image && typeof payload.image === "object" && !Array.isArray(payload.image) ? payload.image as Record<string, unknown> : {};
    const url = typeof video.url === "string" ? video.url : typeof image.url === "string" ? image.url : typeof payload.url === "string" ? payload.url : "";
    return { requestId, status: url ? "completed" : "failed", resultUrl: url || undefined, raw: payload };
  }
}

class HiggsfieldCreativeProvider implements CreativeGenerationProvider {
  readonly id = "higgsfield" as const;
  private readonly provider = new HiggsfieldProvider();

  async quote(request: CreativeGenerationRequest): Promise<CreativeMoneyQuote> {
    const quote = await this.provider.quote(request as VideoGenerationRequest);
    const usdPerCredit = Number(process.env.HIGGSFIELD_USD_PER_CREDIT || "");
    const usdEstimate = Number.isFinite(usdPerCredit) && usdPerCredit > 0 ? Number((quote.reserveCredits * usdPerCredit).toFixed(4)) : null;
    return { currency: "CREDITS", amount: quote.credits, reserveAmount: quote.reserveCredits, exact: quote.exact, source: quote.source === "configured" ? "configured" : "static_anchor", note: `${quote.note || "Higgsfield credit quote."}${usdEstimate === null ? " Set HIGGSFIELD_USD_PER_CREDIT to show a USD equivalent." : ""}`, usdEstimate };
  }

  async submit(request: CreativeGenerationRequest, webhookUrl?: string) { return this.provider.submit(request as VideoGenerationRequest, webhookUrl); }
  async status(requestId: string) { return this.provider.status(requestId); }
}

const PROVIDERS: Record<CreativeProviderId, CreativeGenerationProvider> = {
  bfl: new BflProvider(),
  google: new GoogleProvider(),
  zai: new ZaiProvider(),
  fal: new FalProvider(),
  higgsfield: new HiggsfieldCreativeProvider(),
};

export function creativeProvider(id: CreativeProviderId) { return PROVIDERS[id]; }

export function creativeProviderReadiness(): CreativeProviderReadiness[] {
  const hf = higgsfieldReadiness();
  return [
    { id: "bfl", label: "Black Forest Labs", configured: Boolean(process.env.BFL_API_KEY?.trim()), note: "FLUX.2 image generation" },
    { id: "google", label: "Google Gemini", configured: Boolean(process.env.GEMINI_API_KEY?.trim()), note: "Nano Banana, Veo and Gemini reasoning" },
    { id: "zai", label: "Z.AI General API", configured: Boolean(process.env.ZAI_API_KEY?.trim()), note: "GLM utility models and Vidu 2. Never uses Coding Plan quota." },
    { id: "fal", label: "fal.ai", configured: Boolean(process.env.FAL_KEY?.trim()) && Object.keys(falConfig()).length > 0, note: "Explicitly configured marketplace fallbacks" },
    { id: "higgsfield", label: "Higgsfield", configured: hf.hasCredentials, note: "Premium cinematic and continuity routes" },
  ];
}
