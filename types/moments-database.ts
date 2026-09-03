import type { Json } from "@/types/database";

export type MomentSourceMode = "audio" | "lyrics" | "stems" | "fused";
export type MomentLifecycleState = "proposed" | "approved" | "rejected" | "superseded";

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
    };
    Views: {
      moment_performance_rollups: {
        Row: MomentPerformanceRollup;
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: {
      moment_source_mode: MomentSourceMode;
      moment_lifecycle_state: MomentLifecycleState;
    };
    CompositeTypes: Record<string, never>;
  };
};
