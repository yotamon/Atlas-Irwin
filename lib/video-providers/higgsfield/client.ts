import "server-only";

import type {
  GenerationQuote,
  ProviderStatus,
  ProviderSubmission,
  VideoGenerationRequest,
  VideoGenerationProvider,
  VideoProviderMedia,
} from "../types";
import { higgsfieldModel } from "./catalog";

type HiggsfieldResponse = {
  status?: string;
  request_id?: string;
  status_url?: string;
  cancel_url?: string;
  images?: Array<{ url?: string }>;
  video?: { url?: string };
  detail?: unknown;
  [key: string]: unknown;
};

export class HiggsfieldRequestError extends Error {
  readonly definitelyNotSubmitted: boolean;
  readonly statusCode: number | null;

  constructor(message: string, options: { definitelyNotSubmitted: boolean; statusCode?: number | null }) {
    super(message);
    this.name = "HiggsfieldRequestError";
    this.definitelyNotSubmitted = options.definitelyNotSubmitted;
    this.statusCode = options.statusCode ?? null;
  }
}

export function isHiggsfieldDefiniteRejection(error: unknown): error is HiggsfieldRequestError {
  return error instanceof HiggsfieldRequestError && error.definitelyNotSubmitted;
}

function credentials() {
  const raw = process.env.HF_CREDENTIALS?.trim();
  if (raw && raw.includes(":")) return raw;
  const key = process.env.HF_API_KEY?.trim();
  const secret = (process.env.HF_API_SECRET || process.env.HF_SECRET)?.trim();
  if (key && secret) return `${key}:${secret}`;
  throw new Error("Higgsfield is not configured. Set HF_CREDENTIALS=KEY_ID:KEY_SECRET.");
}

function baseUrl() {
  return (process.env.HIGGSFIELD_BASE_URL?.trim() || "https://platform.higgsfield.ai").replace(/\/$/, "");
}

function endpointMap(): Record<string, string> {
  const raw = process.env.HIGGSFIELD_ENDPOINT_MAP_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1].trim()))
        .map(([model, endpoint]) => [model, endpoint.trim()]),
    );
  } catch {
    throw new Error("HIGGSFIELD_ENDPOINT_MAP_JSON must be valid JSON.");
  }
}

export function resolveHiggsfieldEndpoint(model: string) {
  const configured = endpointMap()[model];
  if (configured) return configured.startsWith("/") ? configured : `/${configured}`;
  if (process.env.HIGGSFIELD_ALLOW_INFERRED_ENDPOINTS === "true") return `/${model}`;
  throw new Error(
    `No verified Higgsfield API endpoint is configured for ${model}. Add it to HIGGSFIELD_ENDPOINT_MAP_JSON. ` +
    "Atlas intentionally refuses to guess paid-generation endpoints.",
  );
}

function imageInput(media: VideoProviderMedia) {
  return { type: "image_url", image_url: media.url };
}

function mapInput(request: VideoGenerationRequest) {
  const medias = request.medias ?? [];
  const start = medias.find((media) => media.role === "start_image");
  const end = medias.find((media) => media.role === "end_image");
  const images = medias.filter((media) => media.role === "image");
  const videos = medias.filter((media) => media.role === "video_reference");
  const audios = medias.filter((media) => media.role === "audio_reference");

  const input: Record<string, unknown> = {
    prompt: request.prompt,
    aspect_ratio: request.aspectRatio,
    ...request.params,
  };

  if (request.operation === "look_image") {
    input.resolution = request.resolution === "4k" ? "4k" : request.resolution === "1080p" ? "2k" : "1k";
  } else {
    input.duration = Math.max(1, Math.round(request.durationSeconds ?? 5));
    if (request.model !== "kling3_0") {
      input.resolution = request.resolution;
      input.generate_audio = false;
    } else {
      delete input.resolution;
      delete input.generate_audio;
      if (typeof input.sound !== "string") input.sound = "off";
    }
  }

  if (start) input.start_image = imageInput(start);
  if (end) input.end_image = imageInput(end);
  if (images.length) input.image_references = images.map(imageInput);
  if (videos.length) input.video_references = videos.map((media) => ({ type: "video_url", video_url: media.url }));
  if (audios.length) input.audio_references = audios.map((media) => ({ type: "audio_url", audio_url: media.url }));
  return input;
}

function normalizedStatus(status?: string): ProviderSubmission["status"] {
  if (status === "completed" || status === "failed" || status === "nsfw" || status === "in_progress") return status;
  return "queued";
}

function parseResponse(payload: HiggsfieldResponse): ProviderSubmission {
  const requestId = typeof payload.request_id === "string" ? payload.request_id : "";
  if (!requestId) throw new Error("Higgsfield returned success without request_id; submission state is ambiguous and must be reconciled before retrying.");
  const resultUrl = payload.video?.url || payload.images?.find((image) => image.url)?.url;
  return {
    requestId,
    status: normalizedStatus(payload.status),
    resultUrl,
    raw: payload,
  };
}

async function providerFetch(path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Key ${credentials()}`,
        "Content-Type": "application/json",
        "User-Agent": "atlas-irwin-video-director/1.0",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (error) {
    throw new HiggsfieldRequestError(
      `Higgsfield network request failed before Atlas received a response: ${error instanceof Error ? error.message : "network error"}. Submission state is ambiguous.`,
      { definitelyNotSubmitted: false },
    );
  }

  const payload = await response.json().catch(() => ({})) as HiggsfieldResponse;
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail ?? payload);
    const definite = response.status >= 400 && response.status < 500;
    const message = response.status === 401
      ? "Higgsfield authentication failed."
      : response.status === 403
        ? "Higgsfield rejected the request because credits or workspace access are insufficient."
        : `Higgsfield request failed (${response.status}): ${detail.slice(0, 800)}`;
    throw new HiggsfieldRequestError(message, {
      definitelyNotSubmitted: definite,
      statusCode: response.status,
    });
  }
  return payload;
}

function configuredQuote(request: VideoGenerationRequest): number | null {
  const raw = process.env.HIGGSFIELD_CREDIT_RATES_JSON?.trim();
  if (!raw) return null;
  try {
    const rates = JSON.parse(raw) as Record<string, unknown>;
    const modelRate = rates[request.model];
    if (typeof modelRate === "number" && Number.isFinite(modelRate) && modelRate >= 0) {
      return request.operation === "look_image" ? modelRate : modelRate * Math.max(1, request.durationSeconds ?? 5);
    }
    if (modelRate && typeof modelRate === "object" && !Array.isArray(modelRate)) {
      const record = modelRate as Record<string, unknown>;
      const resolutionRate = record[request.resolution];
      if (typeof resolutionRate === "number" && Number.isFinite(resolutionRate) && resolutionRate >= 0) {
        return request.operation === "look_image" ? resolutionRate : resolutionRate * Math.max(1, request.durationSeconds ?? 5);
      }
    }
  } catch {
    throw new Error("HIGGSFIELD_CREDIT_RATES_JSON must be valid JSON.");
  }
  return null;
}

function staticAnchorQuote(request: VideoGenerationRequest): number {
  const seconds = Math.max(1, request.durationSeconds ?? 5);
  if (request.operation === "look_image") return 2;

  if (request.model === "kling3_0") {
    const mode = request.params?.mode;
    const perSecond = mode === "4k" ? 6 : mode === "pro" ? 1.75 : 1.5;
    return perSecond * seconds;
  }

  const perSecond720 = request.model === "cinematic_studio_3_0"
    ? 5
    : request.model === "seedance_2_5"
      ? 6.5
      : request.model === "seedance_2_0"
        ? 4.5
        : request.model === "seedance_2_0_mini"
          ? 2.5
          : 5;
  const resolutionMultiplier = request.resolution === "4k" ? 4 : request.resolution === "1080p" ? 2 : 1;
  return perSecond720 * seconds * resolutionMultiplier;
}

export class HiggsfieldProvider implements VideoGenerationProvider {
  async quote(request: VideoGenerationRequest): Promise<GenerationQuote> {
    const configured = configuredQuote(request);
    const credits = configured ?? staticAnchorQuote(request);
    const exact = configured !== null;
    return {
      credits: Number(credits.toFixed(2)),
      reserveCredits: Number((credits * (exact ? 1.05 : 1.25)).toFixed(2)),
      exact,
      source: exact ? "configured" : "static_anchor",
      note: exact
        ? "Configured provider rate."
        : "Conservative planning anchor with a 25% reserve buffer. Refresh configured rates when Higgsfield pricing changes.",
    };
  }

  async submit(request: VideoGenerationRequest, webhookUrl?: string): Promise<ProviderSubmission> {
    const model = higgsfieldModel(request.model);
    if (!model) throw new HiggsfieldRequestError(`Unsupported Higgsfield model: ${request.model}`, { definitelyNotSubmitted: true });
    if (request.operation === "look_image" && model.output !== "image") {
      throw new HiggsfieldRequestError("Image operation requires an image model.", { definitelyNotSubmitted: true });
    }
    if (request.operation !== "look_image" && model.output !== "video") {
      throw new HiggsfieldRequestError("Video operation requires a video model.", { definitelyNotSubmitted: true });
    }
    if (!model.supportedResolutions.includes(request.resolution)) {
      throw new HiggsfieldRequestError(
        `${model.label} does not support ${request.resolution}; Atlas will not rely on a paid provider fallback.`,
        { definitelyNotSubmitted: true },
      );
    }

    let endpoint = resolveHiggsfieldEndpoint(request.model);
    if (webhookUrl) {
      endpoint += `${endpoint.includes("?") ? "&" : "?"}hf_webhook=${encodeURIComponent(webhookUrl)}`;
    }
    const payload = await providerFetch(endpoint, {
      method: "POST",
      body: JSON.stringify(mapInput(request)),
    });
    return parseResponse(payload);
  }

  async status(requestId: string): Promise<ProviderStatus> {
    const payload = await providerFetch(`/requests/${encodeURIComponent(requestId)}/status`);
    return parseResponse(payload);
  }
}

export function higgsfieldReadiness() {
  const hasCredentials = Boolean(
    process.env.HF_CREDENTIALS?.trim() ||
    (process.env.HF_API_KEY?.trim() && (process.env.HF_API_SECRET || process.env.HF_SECRET)?.trim()),
  );
  const mappings = endpointMap();
  return {
    hasCredentials,
    configuredModels: Object.keys(mappings),
    inferredEndpointsEnabled: process.env.HIGGSFIELD_ALLOW_INFERRED_ENDPOINTS === "true",
    hasConfiguredRates: Boolean(process.env.HIGGSFIELD_CREDIT_RATES_JSON?.trim()),
  };
}
