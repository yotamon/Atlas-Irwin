import "server-only";

import { higgsfieldModel, type HiggsfieldModelId } from "@/lib/video-providers/higgsfield/catalog";
import type { VideoGenerationRequest, VideoProviderMedia } from "@/lib/video-providers/types";
import type { CreativeReferenceContext } from "./creative-context";

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
  request: VideoGenerationRequest;
  reason: string;
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

function videoDuration(input: CreativeRouteInput) {
  const selected = input.audioStart !== null && input.audioStart !== undefined && input.audioEnd !== null && input.audioEnd !== undefined
    ? Math.max(4, input.audioEnd - input.audioStart)
    : input.quality === "premium" ? 12 : input.quality === "economy" ? 8 : 10;
  return Math.min(15, Math.max(4, Math.round(selected)));
}

function chooseVideoModel(input: CreativeRouteInput): HiggsfieldModelId {
  const hasMultimodalReference = Boolean(input.context.videoReferences.length || input.context.audioReferenceUrl);
  if (input.quality === "economy") return "seedance_2_0_mini";
  if (hasMultimodalReference) return "seedance_2_5";
  if (input.quality === "premium") return "cinematic_studio_3_0";
  return "seedance_2_0";
}

function imageResolution(quality: CreativeQualityProfile) {
  return quality === "premium" ? "4k" as const : quality === "economy" ? "720p" as const : "1080p" as const;
}

function videoResolution(quality: CreativeQualityProfile) {
  return quality === "economy" ? "720p" as const : "1080p" as const;
}

function mediasFor(input: CreativeRouteInput, modelId: HiggsfieldModelId, outputKind: "image" | "video") {
  const model = higgsfieldModel(modelId);
  if (!model) return [];
  const medias: VideoProviderMedia[] = [];
  if (model.supportsImageReferences) {
    for (const reference of input.context.imageReferences.slice(0, 4)) {
      medias.push({ role: "image", url: reference.url });
    }
  }
  if (outputKind === "video" && model.supportsVideoReferences) {
    const motion = input.context.videoReferences[0];
    if (motion) medias.push({ role: "video_reference", url: motion.url });
  }
  if (outputKind === "video" && model.supportsAudioReferences && input.context.audioReferenceUrl) {
    medias.push({ role: "audio_reference", url: input.context.audioReferenceUrl });
  }
  return medias;
}

function videoParams(model: HiggsfieldModelId, input: CreativeRouteInput) {
  if (model === "seedance_2_5") {
    return {
      mode: input.context.imageReferences.length || input.context.videoReferences.length ? "omni_reference" : "t2v",
      bitrate_mode: input.quality === "economy" ? "standard" : "high",
      generate_audio: false,
    };
  }
  if (model === "seedance_2_0") {
    return { mode: "std", bitrate_mode: "high", generate_audio: false };
  }
  if (model === "seedance_2_0_mini") {
    return { bitrate_mode: "standard", generate_audio: false };
  }
  return { generate_audio: false };
}

export function routeMarketingCreative(input: CreativeRouteInput): CreativeRoute {
  const outputKind = input.mediaKind === "auto" ? autoOutputKind(input.format) : input.mediaKind;
  const ratio = aspectRatio(input.platform, input.format);
  if (outputKind === "image") {
    const model: HiggsfieldModelId = "nano_banana_2";
    return {
      outputKind,
      assetType: "social_image",
      reason: `Nano Banana 2 is the curated image model for Atlas look development. ${input.context.imageReferences.length} ranked visual references will be supplied directly to the model.`,
      request: {
        operation: "look_image",
        model,
        prompt: input.prompt,
        aspectRatio: ratio,
        resolution: imageResolution(input.quality),
        medias: mediasFor(input, model, outputKind),
      },
    };
  }

  const model = chooseVideoModel(input);
  const modelInfo = higgsfieldModel(model);
  const hasAudio = Boolean(input.context.audioReferenceUrl && modelInfo?.supportsAudioReferences);
  const hasMotion = Boolean(input.context.videoReferences.length && modelInfo?.supportsVideoReferences);
  const reason = hasAudio || hasMotion
    ? `${modelInfo?.label || model} was selected because this creative has ${hasAudio ? "track audio" : ""}${hasAudio && hasMotion ? " and " : ""}${hasMotion ? "approved motion" : ""} references, so continuity is more valuable than choosing a model from headline quality alone.`
    : `${modelInfo?.label || model} best matches the ${input.quality} quality profile for this social video.`;
  return {
    outputKind,
    assetType: "content_video",
    reason,
    request: {
      operation: "shot_video",
      model,
      prompt: input.prompt,
      durationSeconds: videoDuration(input),
      aspectRatio: ratio,
      resolution: videoResolution(input.quality),
      medias: mediasFor(input, model, outputKind),
      params: videoParams(model, input),
    },
  };
}
