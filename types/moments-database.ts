import type { Json } from "@/types/database";

export type MomentSourceMode = "audio" | "lyrics" | "stems" | "fused";
export type MomentLifecycleState = "proposed" | "approved" | "rejected" | "superseded";
export type MomentCalibrationJudgment = "best" | "useful" | "poor" | "adjustment";

export type Moment = {
  id: string;
  owner_id: string;
  artist_id: string;
  release_id: string;
  track_id: string;
  start_ms: number;
  end_ms: number;
  source_start_ms: number;
  source_end_ms: number;
  moment_type: string;
  label: string;
  source_mode: MomentSourceMode;
  source_fingerprint: string;
  purpose_tags: string[];
  energy_score: number | null;
  hook_score: number | null;
  emotional_score: number | null;
  vocal_score: number | null;
  uniqueness_score: number | null;
  confidence: number;
  track_analysis_version: number | null;
  track_analysis_audio_sha256: string | null;
  source_candidate_id: string | null;
  lyric_moment_id: string | null;
  lyrics_version: number | null;
  audio_scene_id: string | null;
  audio_scene_recipe_version: number | null;
  evidence: Json;
  state: MomentLifecycleState;
  reviewed_by: string | null;
  reviewed_at: string | null;
  superseded_by_id: string | null;
  created_at: string;
  updated_at: string;
};

export type MomentCalibrationEvent = {
  id: string;
  owner_id: string;
  artist_id: string;
  release_id: string;
  track_id: string;
  moment_id: string;
  moment_source_fingerprint: string;
  moment_track_analysis_version: number | null;
  moment_track_analysis_audio_sha256: string | null;
  source_start_ms: number;
  source_end_ms: number;
  previous_start_ms: number;
  previous_end_ms: number;
  effective_start_ms: number;
  effective_end_ms: number;
  judgment: MomentCalibrationJudgment;
  corrected_purpose: string | null;
  preferred_cut_seconds: number | null;
  preferred_moment_id: string | null;
  preferred_moment_source_fingerprint: string | null;
  evidence: Json;
  created_by: string;
  created_at: string;
};

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type MomentPerformanceRollup = {
  moment_id: string;
  owner_id: string;
  artist_id: string;
  release_id: string;
  content_items: number;
  metric_snapshots: number;
  reach: number;
  views: number;
  watch_time: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  profile_visits: number;
  follows: number;
  link_clicks: number;
  streams: number;
  listeners: number;
  playlist_adds: number;
};

export type MomentsDatabase = {
  public: {
    Tables: {
      moments: Table<Moment>;
      moment_calibration_events: Table<MomentCalibrationEvent>;
    };
    Views: {
      moment_performance_rollups: {
        Row: MomentPerformanceRollup;
        Relationships: [];
      };
    };
    Functions: {
      review_moment_with_calibration: {
        Args: {
          p_moment_id: string;
          p_release_id: string;
          p_decision: "save" | "approve" | "reject";
          p_start_ms: number;
          p_end_ms: number;
          p_label: string;
          p_judgment: MomentCalibrationJudgment;
          p_corrected_purpose?: string | null;
          p_preferred_cut_seconds?: number | null;
          p_preferred_moment_id?: string | null;
          p_evidence?: Json;
        };
        Returns: string;
      };
    };
    Enums: {
      moment_source_mode: MomentSourceMode;
      moment_lifecycle_state: MomentLifecycleState;
      moment_calibration_judgment: MomentCalibrationJudgment;
    };
    CompositeTypes: Record<string, never>;
  };
};
