import type { Json, MediaAsset, MusicVideoProject, Release, Track } from "@/types/database";
import type { TrackLyricsContext } from "@/lib/lyrics-intelligence/context";
import type { CreativeMemoryRecommendation } from "@/lib/creative-memory/server";

export type MusicMapSection = {
  id: string;
  label: string;
  type: string;
  start_ms: number;
  end_ms: number;
  energy: number;
  confidence?: number | null;
  label_confidence?: number | null;
  boundary_confidence?: number | null;
};

export type MusicMapEditPoint = {
  ms: number;
  confidence: number;
  reason: string;
  provenance?: string;
};

export type MusicMomentIntent =
  | "instant_hook"
  | "musical_identity"
  | "groove_loop"
  | "build_drop"
  | "climax"
  | "story_arc";

export type MusicHookIntentScores = Record<MusicMomentIntent, number>;

export type MusicHookMetrics = {
  energy: number;
  energy_lift: number;
  novelty: number;
  onset_density: number;
  boundary_fit: number;
  structure: number;
  melodic_salience: number;
  loopability: number;
  repetition: number;
  groove_stability?: number;
  harmonic_distinctiveness?: number;
  boundary_loop_fit?: number;
  segment_confidence?: number;
  harmonic_recurrence?: number;
  semantic_recurrence?: number;
  arc_strength?: number;
};

export type MusicHookCandidate = {
  id: string;
  label: string;
  kind: MusicMomentIntent | "instant_impact" | "groove" | "melodic" | "build_and_drop" | string;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  target_duration_ms: number;
  section_type: string;
  section_label: string;
  score: number;
  reasons: string[];
  metrics: MusicHookMetrics;
  intent_scores?: MusicHookIntentScores;
};

export type MusicSocialCut = {
  candidate_id: string;
  start_ms: number;
  end_ms: number;
  score: number;
  hook_score?: number;
  kind: string;
  label: string;
  intent_scores?: MusicHookIntentScores;
};

export type MusicMomentReference = {
  candidate_id: string;
  start_ms: number;
  end_ms: number;
  score: number;
  label: string;
};

export type MusicBar = {
  index: number;
  start_ms: number;
  end_ms: number;
  section_id: string | null;
  confidence: number;
  provenance: string;
};

export type MusicPhrase = {
  id: string;
  start_ms: number;
  end_ms: number;
  section_id: string;
  bar_start: number | null;
  bar_end: number | null;
  confidence: number;
  provenance: string;
};

export type MusicMasterQcIssue = {
  severity: "critical" | "warning" | string;
  code: string;
  message: string;
};

export type MusicMasterQc = {
  technical_ready: boolean;
  integrated_lufs?: number | null;
  sample_peak_dbfs?: number | null;
  true_peak_dbtp?: number | null;
  rms_dbfs?: number | null;
  crest_factor_db?: number | null;
  clipping_samples?: number;
  clipping_ratio?: number;
  stereo_correlation?: number | null;
  dc_offset?: number;
  leading_silence_ms?: number;
  trailing_silence_ms?: number;
  sample_rate_hz?: number;
  channels?: number;
  analysis_note?: string;
  issues: MusicMasterQcIssue[];
};

export type MusicMap = {
  version: number;
  duration_ms: number;
  bpm: number | null;
  beat_confidence: number;
  beats_ms: number[];
  beat_positions?: number[];
  downbeats_ms: number[];
  downbeat_source?: "model" | "inferred_from_beats" | "synthetic_grid" | "none";
  bars?: MusicBar[];
  phrases?: MusicPhrase[];
  sections: MusicMapSection[];
  energy_curve: Array<{ ms: number; value: number }>;
  edit_points: MusicMapEditPoint[];
  peaks_ms: number[];
  hook_candidates?: MusicHookCandidate[];
  moments?: Partial<Record<MusicMomentIntent, MusicMomentReference[]>>;
  social_cuts?: Record<string, MusicSocialCut | null>;
  social_cut_options?: Record<string, MusicSocialCut[]>;
  master_qc?: MusicMasterQc;
  source_audio?: {
    url?: string;
    media_asset_id?: string | null;
    audio_sha256?: string;
    analysis_pcm_sha256?: string;
    analysis_config?: string;
  };
  analysis?: {
    engine: string;
    model: string | null;
    quality: "full" | "fallback";
    semantic_structure: boolean;
    real_downbeats: boolean;
    downbeat_source?: "model" | "inferred_from_beats" | "synthetic_grid" | "none";
    embeddings_used?: boolean;
    activation_fps?: number | null;
    config?: string;
    confidence?: {
      overall: number;
      rhythm: number;
      downbeats: number;
      structure: number;
      hooks: number;
    };
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
  artistId: string;
  project: MusicVideoProject;
  release: Release;
  track: Track;
  musicMap: MusicMap | null;
  lyrics: TrackLyricsContext;
  brandSettings: Json[];
  media: Array<Pick<MediaAsset, "id" | "asset_type" | "mime_type" | "metadata" | "public_url">>;
  preferences: DirectorPreferences;
  creativeMemory: {
    summary: string;
    evidenceCount: number;
    recommendations: CreativeMemoryRecommendation[];
  };
};

export interface MusicVideoCreativeDirector {
  createConcepts(context: VideoProjectContext): Promise<VideoConcept[]>;
  createQuickVideoConcept(context: VideoProjectContext): Promise<VideoConcept>;
  createProductionPlan(context: VideoProjectContext, concept: VideoConcept): Promise<ProductionPlan>;
  reviseShot(input: {
    context: VideoProjectContext;
    concept: VideoConcept;
    visualBible: VisualBible;
    currentShot: StoryboardShotRevisionInput;
    instruction: string;
  }): Promise<StoryboardShot>;
}

export function parseMusicMap(value: Json): MusicMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as unknown as Partial<MusicMap>;
  if (!Array.isArray(candidate.sections) || typeof candidate.duration_ms !== "number") return null;
  return candidate as MusicMap;
}
