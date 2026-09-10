import {
  MUSIC_PROVIDER_IDS,
  MUSIC_VIBES,
  MUSIC_VIBE_IDS,
  buildMusicPrompt,
  estimateMusicCost,
  miniMaxGenerationCost,
  safeTrackFilename,
  type MusicGenerationInput,
  type MusicProviderId,
  type MusicVibeId,
} from "./generator";

/**
 * Legacy compatibility surface.
 *
 * Ensemblis Music Lab now uses ./generator directly. These Atlas-prefixed exports
 * remain temporarily so older internal callers do not require a flag-day rename.
 */
export { MUSIC_PROVIDER_IDS, estimateMusicCost, miniMaxGenerationCost, safeTrackFilename };
export type { MusicProviderId };

/** @deprecated Use MUSIC_VIBES from ./generator. */
export const ATLAS_VIBES = MUSIC_VIBES;
/** @deprecated Use MUSIC_VIBE_IDS from ./generator. */
export const ATLAS_VIBE_IDS = MUSIC_VIBE_IDS;
/** @deprecated Use MusicVibeId from ./generator. */
export type AtlasVibeId = MusicVibeId;

/** @deprecated Use MusicGenerationInput from ./generator. */
export type AtlasMusicInput = Omit<MusicGenerationInput, "preserveArtistDna"> & {
  preserveArtistDna?: boolean;
  useAtlasDna?: boolean;
};

/** @deprecated Use buildMusicPrompt from ./generator. */
export function buildAtlasMusicPrompt(input: AtlasMusicInput) {
  return buildMusicPrompt({
    ...input,
    preserveArtistDna: input.preserveArtistDna ?? input.useAtlasDna ?? true,
  });
}
