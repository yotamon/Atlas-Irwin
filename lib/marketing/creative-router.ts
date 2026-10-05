import "server-only";

import { higgsfieldModel, type HiggsfieldModelId } from "@/lib/video-providers/higgsfield/catalog";
import type { VideoProviderMedia } from "@/lib/video-providers/types";
import type { CreativeReferenceContext } from "./creative-context";
import { creativeCandidates, type CreativePreset } from "./creative-provider-catalog";
import { creativeProviderReadiness } from "./creative-providers";
import type { CreativeGenerationRequest, CreativeProviderId } from "./creative-provider-types";

export const CREATIVE_QUALITY_PROFILES = ["economy", "balanced", "premium"] as const;
export type CreativeQualityProfile = (typeof CREATIVE_QUALITY_PROFILES)[number];
export const CREATIVE_MEDIA_KINDS = ["auto", "image", "video"] as const;
export type CreativeMediaKindPreference = (typeof CREATIVE_MEDIA_KINDS)[number];
export type CreativeRouteIntent = "standard" | "seamless_loop";

type CreativeAspectRatio = CreativeGenerationRequest["aspectRatio"];
type CreativeRouteReferenceContext = Pick<CreativeReferenceContext, "imageReferences" | "videoReferences" | "audioReferenceUrl">;

export type CreativeRouteInput = {
  platform: string;
  format: string;
  title: string;
  prompt: string;
  quality: CreativeQualityProfile;
  mediaKind: CreativeMediaKindPreference;
  creativeIntent?: CreativeRouteIntent;
  aspectRatio?: CreativeAspectRatio;
  audioStart?: number | null;
  audioEnd?: number | null;
  context: CreativeRouteReferenceContext;
};

export type CreativeRoute = {
  outputKind: "image" | "video";
  assetType: "social_image" | "content_video";
  request: CreativeGenerationRequest;
  reason: string;
  fallbackUsed: boolean;
  preferredProvider: CreativeProviderId;
  priceLabel: string;
};

function autoOutputKind(format: string): "image" | "video" {
  const normalized = format.toLowerCase();
  if (["reel", "tiktok video", "short", "dj clip", "mood video", "story"].some((token) => normalized.includes(token))) return "video";
  return "image";
}

function inferredAspectRatio(platform: string, format: string, outputKind: "image" | "video"): CreativeAspectRatio {
  const normalized = `${platform} ${format}`.toLowerCase();
  if (normalized.includes("newsletter") || normalized.includes("outreach")) return "1:1";
  if (outputKind === "image" && (
    normalized.includes("instagram") ||
    normalized.includes("feed post") ||
    normalized.includes("carousel") ||
    normalized.includes("tiktok photo")
  )) return "4:5";
  return "9:16";
}

function providerAvailability() {
  return new Map(creativeProviderReadiness().map((provider) => [provider.id, provider.configured]));
}

function routeCompatible(provider: CreativeProviderId, outputKind: "image" | "video", ratio: CreativeAspectRatio) {
  // The current BFL adapter translates unknown ratios to square dimensions. Until it
  // has explicit 4:5 dimension support, silently routing portrait feed work there
  // would violate the platform package contract.
  if (outputKind === "image" && ratio === "4:5" && provider === "bfl") return false;
  return true;
}

function chooseCandidate(quality: CreativePreset, outputKind: "image" | "video", ratio: CreativeAspectRatio) {
  const allCandidates = creativeCandidates(quality, outputKind);
  const compatibleCandidates = allCandidates.filter((candidate) => routeCompatible(candidate.provider, outputKind, ratio));
  const candidates = compatibleCandidates.length ? compatibleCandidates : allCandidates;
  const availability = providerAvailability();
  const configured = candidates.find((candidate) => availability.get(candidate.provider));
  return {
    candidate: configured ?? candidates[0],
    preferred: candidates[0],
    fallbackUsed: Boolean(configured && configured !== candidates[0]),
    configured: Boolean(configured),
  };
}

function higgsfieldPremiumModel(input: CreativeRouteInput): HiggsfieldModelId {
  const hasMultimodalReference = Boolean(input.context.videoReferences.length || input.context.audioReferenceUrl);
  return hasMultimodalReference ? "seedance_2_5" : "cinematic_studio_3_0";
}

function imageResolution(quality: CreativeQualityProfile) {
  return quality === "economy" ? "720p" as const : "1080p" as const;
}

function loopModelForQuality(quality: CreativeQualityProfile): HiggsfieldModelId {
  return quality === "economy"
    ? "seedance_2_0_mini"
    : quality === "premium"
      ? "seedance_2_5"
      : "seedance_2_0";
}

function requestedVideoDuration(input: CreativeRouteInput, provider: CreativeProviderId, model: string) {
  if (input.creativeIntent === "seamless_loop") return 6;
  if (provider === "zai" && model.startsWith("vidu2-")) return 4;
  if (provider === "google" && model.startsWith("veo-3.1-")) return 8;
  const selected = input.audioStart !== null && input.audioStart !== undefined && input.audioEnd !== null && input.audioEnd !== undefined
    ? Math.max(4, input.audioEnd - input.audioStart)
    : input.quality === "premium" ? 12 : input.quality === "economy" ? 6 : 8;
  return Math.min(15, Math.max(4, Math.round(selected)));
}

function videoResolution(quality: CreativeQualityProfile, provider: CreativeProviderId) {
  if (provider === "zai") return "720p" as const;
  return quality === "economy" ? "720p" as const : "1080p" as const;
}

function referenceMedias(input: CreativeRouteInput, provider: CreativeProviderId, model: string, outputKind: "image" | "video") {
  const medias: VideoProviderMedia[] = [];
  const images = input.context.imageReferences;

  if (input.creativeIntent === "seamless_loop") {
    if (provider !== "higgsfield") throw new Error("Seamless loop generation requires a verified start/end-frame provider.");
    const source = images[0];
    if (!source) throw new Error("Seamless loop generation requires an approved image source.");
    const info = higgsfieldModel(model as HiggsfieldModelId);
    if (!info?.supportsStartImage || !info.supportsEndImage) {
      throw new Error(`${info?.label ?? model} does not have verified first/last-frame support.`);
    }
    medias.push({ role: "start_image", url: source.url });
    medias.push({ role: "end_image", url: source.url });
    return medias;
  }

  if (provider === "higgsfield") {
    const info = higgsfieldModel(model as HiggsfieldModelId);
    if (info?.supportsImageReferences) images.slice(0, 4).forEach((reference) => medias.push({ role: "image", url: reference.url }));
    if (outputKind === "video" && info?.supportsVideoReferences && input.context.videoReferences[0]) medias.push({ role: "video_reference", url: input.context.videoReferences[0].url });
    if (outputKind === "video" && info?.supportsAudioReferences && input.context.audioReferenceUrl) medias.push({ role: "audio_reference", url: input.context.audioReferenceUrl });
    return medias;
  }

  const maxImages = provider === "google" && outputKind === "image" && model === "gemini-3.1-flash-image"
    ? 10
    : provider === "bfl" && model !== "flux-2-klein-4b"
      ? 8
      : provider === "bfl"
        ? 4
        : provider === "fal"
          ? 1
          : outputKind === "video"
            ? 1
            : 3;
  images.slice(0, maxImages).forEach((reference) => medias.push({ role: "image", url: reference.url }));
  return medias;
}

function higgsfieldParams(model: string, input: CreativeRouteInput) {
  if (model === "seedance_2_5") return {
    mode: input.context.imageReferences.length || input.context.videoReferences.length ? "omni_reference" : "t2v",
    bitrate_mode: "high",
    generate_audio: false,
  };
  if (model === "seedance_2_0") return { mode: "std", bitrate_mode: "high", generate_audio: false };
  if (model === "seedance_2_0_mini") return { bitrate_mode: "standard", generate_audio: false };
  return { generate_audio: false };
}

export function routeMarketingCreative(input: CreativeRouteInput): CreativeRoute {
  const outputKind = input.creativeIntent === "seamless_loop"
    ? "video"
    : input.mediaKind === "auto" ? autoOutputKind(input.format) : input.mediaKind;
  const ratio = input.creativeIntent === "seamless_loop"
    ? "9:16" as const
    : input.aspectRatio ?? inferredAspectRatio(input.platform, input.format, outputKind);
  const selected = chooseCandidate(input.quality, outputKind, ratio);
  let model = input.creativeIntent === "seamless_loop"
    ? loopModelForQuality(input.quality)
    : selected.candidate.model;
  const provider: CreativeProviderId = input.creativeIntent === "seamless_loop"
    ? "higgsfield"
    : selected.candidate.provider;
  if (provider === "higgsfield" && model === "auto_premium") model = higgsfieldPremiumModel(input);
  const fallbackPrefix = input.creativeIntent === "seamless_loop" ? "" : selected.fallbackUsed
    ? `${selected.preferred.label} is not connected, so Ensemblis selected the next ${input.quality} route: `
    : selected.configured
      ? ""
      : `${selected.preferred.label} is the preferred route but is not connected yet. `;
  const compatibilityNote = ratio === "4:5" ? " Native 4:5 compatibility is required for this package." : "";
  const reason = input.creativeIntent === "seamless_loop"
    ? `Living Artwork uses ${higgsfieldModel(model)?.label ?? model} because this route has verified first + last frame support. The same primary artwork is used at both boundaries so motion can close back onto the source composition.`
    : `${fallbackPrefix}${selected.candidate.label}. ${selected.candidate.reason}${compatibilityNote} ${input.context.imageReferences.length} ranked image reference${input.context.imageReferences.length === 1 ? "" : "s"} are available from visual lineage.`;

  if (outputKind === "image") {
    return {
      outputKind,
      assetType: "social_image",
      reason,
      fallbackUsed: input.creativeIntent === "seamless_loop" ? false : selected.fallbackUsed,
      preferredProvider: input.creativeIntent === "seamless_loop" ? "higgsfield" : selected.preferred.provider,
      priceLabel: input.creativeIntent === "seamless_loop" ? "Higgsfield credit quote" : selected.candidate.priceLabel,
      request: {
        provider,
        operation: "look_image",
        model,
        prompt: input.prompt,
        aspectRatio: ratio,
        resolution: imageResolution(input.quality),
        medias: referenceMedias(input, provider, model, outputKind),
      },
    };
  }

  return {
    outputKind,
    assetType: "content_video",
    reason,
    fallbackUsed: input.creativeIntent === "seamless_loop" ? false : selected.fallbackUsed,
    preferredProvider: input.creativeIntent === "seamless_loop" ? "higgsfield" : selected.preferred.provider,
    priceLabel: input.creativeIntent === "seamless_loop" ? "Higgsfield credit quote" : selected.candidate.priceLabel,
    request: {
      provider,
      operation: "shot_video",
      model,
      prompt: input.prompt,
      durationSeconds: requestedVideoDuration(input, provider, model),
      aspectRatio: ratio,
      resolution: videoResolution(input.quality, provider),
      medias: referenceMedias(input, provider, model, outputKind),
      params: provider === "higgsfield" ? higgsfieldParams(model, input) : undefined,
    },
  };
}
