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

export type CreativeRouteInput = {
  platform: string;
  format: string;
  title: string;
  prompt: string;
  quality: CreativeQualityProfile;
  mediaKind: CreativeMediaKindPreference;
  audioStart?: number | null;
  audioEnd?: number | null;
  context: CreativeReferenceContext;
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
  if (["reel", "tiktok video", "short", "dj clip", "mood video"].some((token) => normalized.includes(token))) return "video";
  return "image";
}

function aspectRatio(platform: string, format: string): "9:16" | "1:1" {
  const normalized = `${platform} ${format}`.toLowerCase();
  if (normalized.includes("feed post") || normalized.includes("carousel") || normalized.includes("newsletter") || normalized.includes("outreach")) return "1:1";
  return "9:16";
}

function providerAvailability() {
  return new Map(creativeProviderReadiness().map((provider) => [provider.id, provider.configured]));
}

function chooseCandidate(quality: CreativePreset, outputKind: "image" | "video") {
  const candidates = creativeCandidates(quality, outputKind);
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

function requestedVideoDuration(input: CreativeRouteInput, provider: CreativeProviderId, model: string) {
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
  const outputKind = input.mediaKind === "auto" ? autoOutputKind(input.format) : input.mediaKind;
  const ratio = aspectRatio(input.platform, input.format);
  const selected = chooseCandidate(input.quality, outputKind);
  let model = selected.candidate.model;
  if (selected.candidate.provider === "higgsfield" && model === "auto_premium") model = higgsfieldPremiumModel(input);
  const provider = selected.candidate.provider;
  const fallbackPrefix = selected.fallbackUsed
    ? `${selected.preferred.label} is not connected, so Atlas selected the next ${input.quality} route: `
    : selected.configured
      ? ""
      : `${selected.preferred.label} is the preferred route but is not connected yet. `;
  const reason = `${fallbackPrefix}${selected.candidate.label}. ${selected.candidate.reason} ${input.context.imageReferences.length} ranked image reference${input.context.imageReferences.length === 1 ? "" : "s"} are available from visual lineage.`;

  if (outputKind === "image") {
    return {
      outputKind,
      assetType: "social_image",
      reason,
      fallbackUsed: selected.fallbackUsed,
      preferredProvider: selected.preferred.provider,
      priceLabel: selected.candidate.priceLabel,
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
    fallbackUsed: selected.fallbackUsed,
    preferredProvider: selected.preferred.provider,
    priceLabel: selected.candidate.priceLabel,
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
