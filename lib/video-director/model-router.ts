import type { ExtendedMusicVideoShot } from "@/types/video-database";
import { VIDEO_MODEL_OFFERS, type VideoModelOffer } from "@/lib/video-providers/catalog";
import type { VideoResolution } from "./domain";
import {
  productionProfileDefinition,
  type VideoProductionProfile,
} from "./production-profile";

export type ShotRoutingAlternative = {
  model: string;
  modelLabel: string;
  provider: string;
  providerLabel: string;
  score: number;
};

export type ShotRoutingDecision = {
  model: string;
  provider: string;
  modelLabel: string;
  providerLabel: string;
  reason: string;
  score: number;
  params: Record<string, unknown>;
  alternatives: ShotRoutingAlternative[];
};

type RouterInput = Pick<ExtendedMusicVideoShot,
  "generation_priority" | "capability_profile" | "start_asset_id" | "end_asset_id" | "reference_asset_ids" | "music_context"
> & {
  targetResolution: VideoResolution;
  isTest?: boolean;
  productionProfile?: VideoProductionProfile;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function genericReferenceCount(input: RouterInput) {
  return Array.isArray(input.reference_asset_ids) ? input.reference_asset_ids.length : 0;
}

function hasReferences(input: RouterInput) {
  return Boolean(input.start_asset_id || input.end_asset_id || genericReferenceCount(input));
}

function scoreModel(model: VideoModelOffer, input: RouterInput) {
  if (model.output !== "video") return -Infinity;
  if (!model.supportedResolutions.includes(input.targetResolution)) return -Infinity;
  if (input.end_asset_id && !model.supportsEndImage) return -Infinity;
  if (input.start_asset_id && !model.supportsStartImage) return -Infinity;
  if (genericReferenceCount(input) > 0 && !model.supportsImageReferences) return -Infinity;

  const profile = record(input.capability_profile);
  const music = record(input.music_context);
  if (profile.requires_audio_reference === true && !model.supportsAudioReferences) return -Infinity;
  if (profile.requires_video_reference === true && !model.supportsVideoReferences) return -Infinity;

  const production = productionProfileDefinition(input.productionProfile ?? "balanced");
  let score = (
    model.quality * production.qualityWeight
    + model.costEfficiency * production.costWeight
    + model.consistency * production.consistencyWeight
  );

  // Higher production profiles progressively reward premium-capability models without
  // overriding hard capability constraints or shot-specific requirements.
  score += Math.max(0, model.quality - 8) * production.premiumBoost;

  if (input.isTest) score += model.costEfficiency * production.testCostBias;
  if (hasReferences(input)) score += model.consistency * 1.8;
  if (profile.requires_audio_reference === true) score += 8;
  if (profile.requires_video_reference === true) score += 8;
  if (profile.hero === true || music.energy === "peak") {
    score += model.quality * (1.4 + production.premiumBoost * 0.35);
  }
  if (profile.complex_motion === true && model.id === "kling3_0") score += 8;
  if (profile.continuity_critical === true) score += model.consistency * 2.4;

  switch (input.generation_priority) {
    case "cost":
      score += model.costEfficiency * 3;
      break;
    case "quality":
      score += model.quality * 3;
      break;
    case "consistency":
      score += model.consistency * 3;
      break;
    case "capability":
      score += model.supportsVideoReferences ? 5 : 0;
      score += model.supportsAudioReferences ? 5 : 0;
      break;
    default:
      score += model.quality + model.costEfficiency + model.consistency;
  }
  return score;
}

function generationParams(model: VideoModelOffer, input: RouterInput) {
  const params: Record<string, unknown> = { generate_audio: false };
  if (model.id === "seedance_2_0") {
    params.mode = input.targetResolution === "4k" || input.targetResolution === "1080p"
      ? "std"
      : (input.isTest ? "fast" : "std");
    params.bitrate_mode = input.isTest ? "standard" : "high";
  }
  if (model.id === "seedance_2_0_mini") {
    params.bitrate_mode = input.isTest ? "standard" : "high";
  }
  if (model.id === "seedance_2_5") {
    params.mode = hasReferences(input) ? "omni_reference" : "t2v";
    params.bitrate_mode = input.isTest ? "standard" : "high";
  }
  if (model.id === "kling3_0") {
    params.mode = input.targetResolution === "4k"
      ? "4k"
      : input.generation_priority === "quality" || input.productionProfile === "maximum"
        ? "pro"
        : "std";
    params.sound = "off";
    delete params.generate_audio;
  }
  return params;
}

export function routeVideoShot(input: RouterInput): ShotRoutingDecision {
  const production = productionProfileDefinition(input.productionProfile ?? "balanced");
  const ranked = VIDEO_MODEL_OFFERS
    .filter((model) => model.output === "video")
    .map((model) => ({ model, score: scoreModel(model, input) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  if (!winner) throw new Error("No video model satisfies the shot requirements, references, and requested resolution.");

  const alternatives = ranked.slice(1, 4).map(({ model, score }) => ({
    model: model.id,
    modelLabel: model.label,
    provider: model.provider,
    providerLabel: model.providerLabel,
    score: Number(score.toFixed(2)),
  }));

  const requirement = input.isTest
    ? "representative test"
    : `${input.generation_priority} shot`;
  return {
    model: winner.model.id,
    provider: winner.model.provider,
    modelLabel: winner.model.label,
    providerLabel: winner.model.providerLabel,
    score: Number(winner.score.toFixed(2)),
    params: generationParams(winner.model, input),
    alternatives,
    reason: `${winner.model.label} via ${winner.model.providerLabel} is the strongest fit for this ${requirement} under the ${production.label} production profile at ${input.targetResolution}.`,
  };
}

export function routeLookDevelopmentModel() {
  return VIDEO_MODEL_OFFERS.find((model) => model.id === "nano_banana_2")!;
}
