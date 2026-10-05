export const LIVING_ARTWORK_WORKFLOW = "living_artwork" as const;

export const LIVING_ARTWORK_STAGES = [
  "source",
  "motion",
  "make_loop",
  "review",
  "export",
] as const;

export type LivingArtworkStage = typeof LIVING_ARTWORK_STAGES[number];

export const LIVING_ARTWORK_MOTION_PRESETS = [
  {
    id: "subtle_pulse",
    label: "Subtle pulse",
    description: "Keep the composition stable while light, reflections and texture move gently.",
    prompt: "Subtle hypnotic cyclic motion. Keep the composition and camera stable. Let light, reflections and texture breathe gently with restrained rhythmic motion.",
  },
  {
    id: "rhythmic_motion",
    label: "Rhythmic motion",
    description: "Use clearer movement and pulse while preserving the artwork identity.",
    prompt: "Rhythmic cyclic motion with confident musical energy. Preserve the artwork identity, framing and typography while secondary elements move in a controlled repeating pattern.",
  },
  {
    id: "dreamlike_motion",
    label: "Dreamlike motion",
    description: "Allow a more surreal living-artwork treatment without changing the core composition.",
    prompt: "Dreamlike cyclic movement with atmospheric depth and fluid secondary motion. Preserve the central subject, composition, typography and recognizable visual identity.",
  },
] as const;

export type LivingArtworkMotionPresetId = typeof LIVING_ARTWORK_MOTION_PRESETS[number]["id"];

export const LIVING_ARTWORK_LOOP_ROLE = "living_artwork_loop";
export const LIVING_ARTWORK_RAW_LOOP_ROLE = "living_artwork_loop_raw";
export const LIVING_ARTWORK_FULL_TRACK_ROLE = "living_artwork_full_track";
export const LIVING_ARTWORK_SOCIAL_ROLE = "living_artwork_social";

export const LIVING_ARTWORK_TARGET = {
  width: 1080,
  height: 1920,
  aspectRatio: "9:16" as const,
  fps: 30,
  recommendedDurationSeconds: 6,
  minDurationSeconds: 4,
  maxDurationSeconds: 10,
};

export type LivingArtworkStageState = {
  sourceReady: boolean;
  motionReady: boolean;
  processing: boolean;
  rawLoopReady: boolean;
  approvedLoopReady: boolean;
};

export function deriveLivingArtworkStage(state: LivingArtworkStageState): LivingArtworkStage {
  if (state.approvedLoopReady) return "export";
  if (state.rawLoopReady) return "review";
  if (state.processing || state.motionReady) return "make_loop";
  if (state.sourceReady) return "motion";
  return "source";
}

export function livingArtworkMotionPreset(id: string | null | undefined) {
  return LIVING_ARTWORK_MOTION_PRESETS.find((preset) => preset.id === id)
    ?? LIVING_ARTWORK_MOTION_PRESETS[0];
}

export function buildLivingArtworkPrompt(input: {
  presetId: string | null | undefined;
  artistContext?: string | null;
  releaseTitle?: string | null;
}) {
  const preset = livingArtworkMotionPreset(input.presetId);
  return [
    preset.prompt,
    input.artistContext ? `Artist visual rules: ${input.artistContext}` : null,
    input.releaseTitle ? `Release context: ${input.releaseTitle}.` : null,
    "SEAMLESS LOOP CONTRACT: use the supplied image as both the first and last frame. All motion must naturally return to the exact starting composition by the final frame.",
    "No cuts. No camera jump. No new text. Do not redraw, replace or distort existing typography. Do not introduce new objects or change identity-defining facial/body features.",
    "The end-to-start transition must be visually continuous when repeated indefinitely.",
  ].filter(Boolean).join("\n");
}
