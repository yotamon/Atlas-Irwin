export type HiggsfieldModelId =
  | "nano_banana_2"
  | "cinematic_studio_3_0"
  | "seedance_2_5"
  | "seedance_2_0"
  | "seedance_2_0_mini"
  | "kling3_0";

export type HiggsfieldResolution = "480p" | "720p" | "1080p" | "4k";

export type HiggsfieldModelCapability = {
  id: HiggsfieldModelId;
  label: string;
  output: "image" | "video";
  quality: number;
  costEfficiency: number;
  consistency: number;
  supportsStartImage: boolean;
  supportsEndImage: boolean;
  supportsImageReferences: boolean;
  supportsVideoReferences: boolean;
  supportsAudioReferences: boolean;
  supports4k: boolean;
  supportedResolutions: readonly HiggsfieldResolution[];
  minDuration?: number;
  maxDuration?: number;
  recommendedFor: string[];
};

// Deliberately small, curated set for music-video production. Capability values are
// synchronized with the Higgsfield model catalog and kept explicit so the router never
// relies on a provider-side resolution fallback for paid generations.
export const HIGGSFIELD_MODELS: readonly HiggsfieldModelCapability[] = [
  {
    id: "nano_banana_2",
    label: "Nano Banana 2",
    output: "image",
    quality: 9,
    costEfficiency: 9,
    consistency: 8,
    supportsStartImage: false,
    supportsEndImage: false,
    supportsImageReferences: true,
    supportsVideoReferences: false,
    supportsAudioReferences: false,
    supports4k: true,
    supportedResolutions: ["720p", "1080p", "4k"],
    recommendedFor: ["look_dev", "storyboard", "reference_frame"],
  },
  {
    id: "cinematic_studio_3_0",
    label: "Cinema Studio Video 3.0",
    output: "video",
    quality: 10,
    costEfficiency: 5,
    consistency: 8,
    supportsStartImage: true,
    supportsEndImage: true,
    supportsImageReferences: true,
    supportsVideoReferences: false,
    supportsAudioReferences: false,
    supports4k: true,
    supportedResolutions: ["720p", "1080p", "4k"],
    minDuration: 4,
    maxDuration: 15,
    recommendedFor: ["hero", "cinematic", "climax", "precision_camera"],
  },
  {
    id: "seedance_2_5",
    label: "Seedance 2.5",
    output: "video",
    quality: 9,
    costEfficiency: 5,
    consistency: 10,
    supportsStartImage: true,
    supportsEndImage: true,
    supportsImageReferences: true,
    supportsVideoReferences: true,
    supportsAudioReferences: true,
    supports4k: false,
    supportedResolutions: ["720p", "1080p"],
    minDuration: 4,
    maxDuration: 30,
    recommendedFor: ["reference_heavy", "continuity", "multimodal", "extension"],
  },
  {
    id: "seedance_2_0",
    label: "Seedance 2.0",
    output: "video",
    quality: 9,
    costEfficiency: 7,
    consistency: 9,
    supportsStartImage: true,
    supportsEndImage: true,
    supportsImageReferences: true,
    supportsVideoReferences: true,
    supportsAudioReferences: true,
    supports4k: true,
    supportedResolutions: ["720p", "1080p", "4k"],
    minDuration: 4,
    maxDuration: 15,
    recommendedFor: ["continuity", "reference_heavy", "music_context", "general"],
  },
  {
    id: "seedance_2_0_mini",
    label: "Seedance 2.0 Mini",
    output: "video",
    quality: 7,
    costEfficiency: 10,
    consistency: 8,
    supportsStartImage: true,
    supportsEndImage: true,
    supportsImageReferences: true,
    supportsVideoReferences: true,
    supportsAudioReferences: true,
    supports4k: false,
    supportedResolutions: ["720p"],
    minDuration: 4,
    maxDuration: 15,
    recommendedFor: ["test", "simple_motion", "budget", "alternative"],
  },
  {
    id: "kling3_0",
    label: "Kling 3.0",
    output: "video",
    quality: 9,
    costEfficiency: 7,
    consistency: 7,
    supportsStartImage: true,
    supportsEndImage: true,
    supportsImageReferences: false,
    supportsVideoReferences: false,
    supportsAudioReferences: false,
    supports4k: true,
    supportedResolutions: ["720p", "1080p", "4k"],
    minDuration: 3,
    maxDuration: 15,
    recommendedFor: ["physics", "movement", "multi_shot", "alternative"],
  },
] as const;

export function higgsfieldModel(id: string) {
  return HIGGSFIELD_MODELS.find((model) => model.id === id) ?? null;
}
