import type { Json, MediaAsset, MusicVideoProject, Release, Track } from "@/types/database";

export type MusicMapSection = {
  id: string;
  label: string;
  type: string;
  start_ms: number;
  end_ms: number;
  energy: number;
  confidence?: number | null;
};

export type MusicMapEditPoint = {
  ms: number;
  confidence: number;
  reason: string;
};

export type MusicHookMetrics = {
  energy: number;
  energy_lift: number;
  novelty: number;
  onset_density: number;
  melodic_salience: number;
  boundary_fit: number;
  loopability: number;
  structure: number;
  repetition: number;
};

export type MusicHookCandidate = {
  id: string;
  label: string;
  kind: "instant_impact" | "groove" | "melodic" | "climax" | "build_and_drop" | string;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  target_duration_ms: number;
  section_type: string;
  section_label: string;
  score: number;
  reasons: string[];
  metrics: MusicHookMetrics;
};

export type MusicSocialCut = {
  candidate_id: string;
  start_ms: number;
  end_ms: number;
  score: number;
  kind: string;
  label: string;
};

export type MusicMap = {
  version: number;
  duration_ms: number;
  bpm: number | null;
  beat_confidence: number;
  beats_ms: number[];
  beat_positions?: number[];
  downbeats_ms: number[];
  sections: MusicMapSection[];
  energy_curve: Array<{ ms: number; value: number }>;
  edit_points: MusicMapEditPoint[];
  peaks_ms: number[];
  hook_candidates?: MusicHookCandidate[];
  social_cuts?: Record<string, MusicSocialCut | null>;
  analysis?: {
    engine: string;
    model: string | null;
    quality: "full" | "fallback";
    semantic_structure: boolean;
    real_downbeats: boolean;
    warnings: string[];
  };
  source: "worker" | "manual" | "fallback";
};

export type VideoConcept = {
  title: string;
  premise: string;
  story: string;
  visual_language: string;
  camera_language: string;
  recurring_motif: string;
  world: string;
  character_strategy: string;
  beginning: string;
  middle: string;
  ending: string;
  musical_fit: string;
  complexity: "low" | "medium" | "high";
  anti_cliches: string[];
  signature_moments: Array<{ time_ms: number; description: string }>;
};

export type VisualBible = {
  world: string;
  palette: string[];
  materials: string[];
  camera_rules: string[];
  lighting_rules: string[];
  texture_rules: string[];
  continuity_rules: string[];
  recurring_motifs: string[];
  avoid: string[];
};

export type StoryboardShot = {
  start_ms: number;
  end_ms: number;
  description: string;
  prompt: string;
  negative_prompt: string;
  camera: string;
  transition_in: string;
  transition_out: string;
  vertical_safe: boolean;
  vertical_focus: "left" | "center" | "right";
  generation_priority: "cost" | "balanced" | "quality" | "consistency" | "capability";
  reuse_strategy: "unique" | "reuse_source" | "continuation" | "reframe" | "hold" | "loop";
  capability_profile: {
    hero: boolean;
    continuity_critical: boolean;
    complex_motion: boolean;
    requires_audio_reference: boolean;
    requires_video_reference: boolean;
  };
};

export type StoryboardShotRevisionInput = Omit<StoryboardShot, "vertical_safe" | "vertical_focus"> & {
  vertical_safe?: boolean;
  vertical_focus?: "left" | "center" | "right";
};

export type StoryboardScene = {
  title: string;
  start_ms: number;
  end_ms: number;
  description: string;
  visual_intent: string;
  shots: StoryboardShot[];
};

export type ProductionPlan = {
  visual_bible: VisualBible;
  scenes: StoryboardScene[];
  look_dev_prompts: Array<{
    label: string;
    prompt: string;
    purpose: string;
  }>;
  test_shot_indexes: number[];
  editing_strategy: string;
  reuse_strategy: string;
  production_notes: string[];
};

export type DirectorPreferences = {
  positive: string[];
  negative: string[];
};

export type VideoProjectContext = {
  project: MusicVideoProject;
  release: Release;
  track: Track;
  musicMap: MusicMap | null;
  brandSettings: Json[];
  media: Array<Pick<MediaAsset, "id" | "asset_type" | "mime_type" | "metadata" | "public_url">>;
  preferences: DirectorPreferences;
};

export interface MusicVideoCreativeDirector {
  createConcepts(context: VideoProjectContext): Promise<VideoConcept[]>;
  createProductionPlan(context: VideoProjectContext, concept: VideoConcept): Promise<ProductionPlan>;
  reviseShot(input: {
    context: VideoProjectContext;
    concept: VideoConcept;
    visualBible: VisualBible;
    currentShot: StoryboardShotRevisionInput;
    instruction: string;
  }): Promise<StoryboardShot>;
}

export function parseMusicMap(value: unknown): MusicMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const map = value as Partial<MusicMap>;
  if (!Array.isArray(map.sections) || !Array.isArray(map.energy_curve) || typeof map.duration_ms !== "number") return null;
  return map as MusicMap;
}
