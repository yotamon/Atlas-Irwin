import type {
  ContentItem,
  Database,
  Json,
  MusicVideoProject,
  MusicVideoRender,
} from "./database";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type StemProvider = "manual" | "suno" | "cubase" | "ableton" | "logic" | "other";
export type StemCategory =
  | "vocals"
  | "drums"
  | "bass"
  | "percussion"
  | "guitar"
  | "keys"
  | "synth"
  | "strings"
  | "brass"
  | "woodwinds"
  | "fx"
  | "other";
export type StemStatus = "uploaded" | "queued" | "analyzing" | "ready" | "failed" | "stale";
export type AudioSceneType =
  | "vocal_spotlight"
  | "groove"
  | "atmosphere"
  | "instrument_spotlight"
  | "voiceover_bed"
  | "progressive_reveal"
  | "vocal_to_drop"
  | "full_impact"
  | "custom";
export type AudioSceneStatus = "ready" | "stale" | "rendering" | "failed";

export type TrackStem = {
  id: string;
  owner_id: string;
  artist_id: string;
  track_id: string;
  media_asset_id: string;
  source_provider: StemProvider;
  category: StemCategory;
  label: string;
  source_filename: string | null;
  display_order: number;
  status: StemStatus;
  source_master_url: string;
  source_master_media_asset_id: string | null;
  source_stem_sha256: string | null;
  analysis_pcm_sha256: string | null;
  duration_ms: number | null;
  sample_rate: number | null;
  channels: number | null;
  offset_ms: number;
  alignment_confidence: number | null;
  analysis_version: number;
  analysis: Json;
  alignment: Json;
  user_overrides: Json;
  error: string | null;
  analyzed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AudioScene = {
  id: string;
  owner_id: string;
  artist_id: string;
  track_id: string;
  name: string;
  scene_type: AudioSceneType;
  source: "system" | "user";
  status: AudioSceneStatus;
  description: string | null;
  recipe_version: number;
  recipe: Json;
  objective_tags: string[];
  platform_hints: string[];
  recommended_start_ms: number | null;
  recommended_end_ms: number | null;
  score: number | null;
  rationale: Json;
  stem_set_fingerprint: string | null;
  preview_asset_id: string | null;
  preview_error: string | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
};

export type TrackStemJob = {
  id: string;
  owner_id: string;
  artist_id: string;
  track_id: string;
  stem_id: string | null;
  scene_id: string | null;
  job_type: "analyze_stem" | "render_audio_scene";
  status: "planned" | "queued" | "running" | "completed" | "failed" | "cancelled";
  idempotency_key: string;
  request_payload: Json;
  result_payload: Json;
  external_job_id: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TrackMusicIntelligence = {
  track_id: string;
  owner_id: string;
  artist_id: string;
  analysis_version: number;
  engine: string;
  quality: "full" | "fallback";
  semantic_structure: boolean;
  source_audio_url: string | null;
  source_media_asset_id: string | null;
  audio_sha256: string | null;
  analysis_config: string | null;
  downbeat_source: "model" | "inferred_from_beats" | "synthetic_grid" | "none";
  analysis: Json;
  analyzed_at: string;
  created_at: string;
  updated_at: string;
};

export type StemAwareContentItem = ContentItem & {
  artist_id: string;
  audio_scene_id: string | null;
  audio_scene_source: "manual" | "stem_intelligence" | null;
  audio_scene_reason: string | null;
};

export type StemAwareVideoProject = MusicVideoProject & {
  audio_scene_id: string | null;
};

export type StemAwareVideoRender = MusicVideoRender & {
  audio_scene_id: string | null;
};

type ExistingTables = Database["public"]["Tables"];

export type StemDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<ExistingTables, "content_items" | "music_video_projects" | "music_video_renders"> & {
      content_items: Table<StemAwareContentItem>;
      music_video_projects: Table<StemAwareVideoProject>;
      music_video_renders: Table<StemAwareVideoRender>;
      track_music_intelligence: Table<TrackMusicIntelligence>;
      track_stems: Table<TrackStem>;
      audio_scenes: Table<AudioScene>;
      track_stem_jobs: Table<TrackStemJob>;
    };
  };
};
