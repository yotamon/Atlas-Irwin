import {
  LIVING_ARTWORK_TARGET,
  buildLivingArtworkPrompt,
  type LivingArtworkMotionPresetId,
} from "./living-artwork";

export type LoopKitManifest = {
  version: 1;
  artistId: string;
  releaseId: string | null;
  contentItemId: string;
  sourceAssetId: string | null;
  sourceFrameUrl: string;
  aspectRatio: "9:16";
  recommendedDurationSeconds: number;
  prompt: string;
  firstFrameInstruction: "use_source";
  lastFrameInstruction: "use_same_source";
};

export function createLoopKitManifest(input: {
  artistId: string;
  releaseId: string | null;
  contentItemId: string;
  sourceAssetId: string | null;
  sourceFrameUrl: string;
  motionPreset: LivingArtworkMotionPresetId;
  artistContext?: string | null;
  releaseTitle?: string | null;
}): LoopKitManifest {
  return {
    version: 1,
    artistId: input.artistId,
    releaseId: input.releaseId,
    contentItemId: input.contentItemId,
    sourceAssetId: input.sourceAssetId,
    sourceFrameUrl: input.sourceFrameUrl,
    aspectRatio: LIVING_ARTWORK_TARGET.aspectRatio,
    recommendedDurationSeconds: LIVING_ARTWORK_TARGET.recommendedDurationSeconds,
    prompt: buildLivingArtworkPrompt({
      presetId: input.motionPreset,
      artistContext: input.artistContext,
      releaseTitle: input.releaseTitle,
    }),
    firstFrameInstruction: "use_source",
    lastFrameInstruction: "use_same_source",
  };
}
