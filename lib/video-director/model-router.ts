import type { ExtendedMusicVideoShot } from "@/types/video-database";
import { HIGGSFIELD_MODELS, type HiggsfieldModelCapability } from "@/lib/video-providers/higgsfield/catalog";
import type { VideoResolution } from "./domain";

export type ShotRoutingDecision = {
  model: HiggsfieldModelCapability["id"];
  reason: string;
  score: number;
  params: Record<string, unknown>;
};

type RouterInput = Pick<ExtendedMusicVideoShot,
  "generation_priority" | "capability_profile" | "start_asset_id" | "end_asset_id" | "reference_asset_ids" | "music_context"
> & {
  targetResolution: VideoResolution;
  isTest?: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasReferences(input: RouterInput) {
  return Boolean(input.start_asset_id || input.end_asset_id) ||
    (Array.isArray(input.reference_asset_ids) && input.reference_asset_ids.length > 0);
}

function scoreModel(model: HiggsfieldModelCapability, input: RouterInput) {
  if (model.output !== "video") return -Infinity;
  if (!model.supportedResolutions.includes(input.targetResolution)) return -Infinity;
  if (input.end_asset_id && !model.supportsEndImage) return -Infinity;
  if (input.start_asset_id && !model.supportsStartImage) return -Infinity;

  const profile = record(input.capability_profile);
  const music = record(input.music_context);
  if (profile.requires_audio_reference === true && !model.supportsAudioReferences) return -Infinity;
  if (profile.requires_video_reference === true && !model.supportsVideoReferences) return -Infinity;

  let score = model.quality * 1.8 + model.costEfficiency + model.consistency * 1.2;

  if (input.isTest) score += model.costEfficiency * 2.6;
  if (hasReferences(input)) score += model.consistency * 1.8;
  if (profile.requires_audio_reference === true) score += 8;
  if (profile.requires_video_reference === true) score += 8;
  if (profile.hero === true || music.energy === "peak") score += model.quality * 1.8;
  if (profile.complex_motion === true && model.id === "kling3_0") score += 8;
  if (profile.continuity_critical === true) score += model.consistency * 2.2;

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

export function routeVideoShot(input: RouterInput): ShotRoutingDecision {
  const ranked = HIGGSFIELD_MODELS
    .filter((model) => model.output === "video")
    .map((model) => ({ model, score: scoreModel(model, input) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  if (!winner) throw new Error("No video model satisfies the shot requirements at the requested resolution.");

  const params: Record<string, unknown> = { generate_audio: false };
  if (winner.model.id === "seedance_2_0") {
    params.mode = input.targetResolution === "4k" || input.targetResolution === "1080p" ? "std" : (input.isTest ? "fast" : "std");
    params.bitrate_mode = input.isTest ? "standard" : "high";
  }
  if (winner.model.id === "seedance_2_0_mini") {
    params.bitrate_mode = input.isTest ? "standard" : "high";
  }
  if (winner.model.id === "seedance_2_5") {
    params.mode = hasReferences(input) ? "omni_reference" : "t2v";
    params.bitrate_mode = input.isTest ? "standard" : "high";
  }
  if (winner.model.id === "kling3_0") {
    params.mode = input.targetResolution === "4k" ? "4k" : input.generation_priority === "quality" ? "pro" : "std";
    params.sound = "off";
    delete params.generate_audio;
  }

  return {
    model: winner.model.id,
    score: winner.score,
    params,
    reason: input.isTest
      ? `${winner.model.label} balances test cost with the required shot capabilities at ${input.targetResolution}.`
      : `${winner.model.label} best matches the shot's ${input.generation_priority} priority, references, and ${input.targetResolution} target.`,
  };
}

export function routeLookDevelopmentModel() {
  return HIGGSFIELD_MODELS.find((model) => model.id === "nano_banana_2")!;
}
