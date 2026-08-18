import type {
  Database,
  Json,
  MusicVideoApproval,
  MusicVideoConcept,
  MusicVideoGeneration,
  MusicVideoProject,
  MusicVideoRender,
  MusicVideoScene,
  MusicVideoShot,
} from "./database";
import type { VideoProjectStatus } from "@/lib/video-director/domain";

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type ExtendedMusicVideoProject = MusicVideoProject & {
  production_plan: Json;
  director_notes: Json;
  render_manifest: Json;
  quality_profile: "economy" | "balanced" | "premium";
  previous_status: VideoProjectStatus | null;
  last_error: string | null;
  analysis_requested_at: string | null;
  analysis_completed_at: string | null;
  creative_generated_at: string | null;
};

export type ExtendedMusicVideoShot = MusicVideoShot & {
  reference_asset_ids: Json;
  reuse_strategy: "unique" | "reuse_source" | "continuation" | "reframe" | "hold" | "loop";
  generation_priority: "cost" | "balanced" | "quality" | "consistency" | "capability";
  review_note: string | null;
  music_context: Json;
  prompt_version: number;
};

export type ExtendedMusicVideoApproval = MusicVideoApproval & {
  reserved_credits: number;
  revoked_at: string | null;
  label: string | null;
};

export type ExtendedMusicVideoGeneration = MusicVideoGeneration & {
  retry_of_id: string | null;
  prompt_version: number;
  request_hash: string | null;
  error: string | null;
};

export type MusicVideoWorkerJob = {
  id: string;
  owner_id: string;
  project_id: string;
  job_type:
    | "analyze_audio"
    | "extract_audio_segment"
    | "extract_frame"
    | "render_master"
    | "render_social"
    | "render_promo"
    | "render_hook";
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

export type MusicVideoDirectorPreferences = {
  owner_id: string;
  positive_signals: Json;
  negative_signals: Json;
  feedback_history: Json;
  updated_at: string;
  created_at: string;
};

type ExistingTables = Database["public"]["Tables"];
type VideoTableNames =
  | "music_video_projects"
  | "music_video_concepts"
  | "music_video_scenes"
  | "music_video_shots"
  | "music_video_approvals"
  | "music_video_generations"
  | "music_video_renders";

export type VideoDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Omit<ExistingTables, VideoTableNames> & {
      music_video_projects: Table<ExtendedMusicVideoProject>;
      music_video_concepts: Table<MusicVideoConcept>;
      music_video_scenes: Table<MusicVideoScene>;
      music_video_shots: Table<ExtendedMusicVideoShot>;
      music_video_approvals: Table<ExtendedMusicVideoApproval>;
      music_video_generations: Table<ExtendedMusicVideoGeneration>;
      music_video_renders: Table<MusicVideoRender>;
      music_video_worker_jobs: Table<MusicVideoWorkerJob>;
      music_video_director_preferences: Table<MusicVideoDirectorPreferences>;
    };
    Functions: Database["public"]["Functions"] & {
      reserve_music_video_generation: {
        Args: { p_generation_id: string };
        Returns: ExtendedMusicVideoGeneration;
      };
      settle_music_video_generation: {
        Args: {
          p_generation_id: string;
          p_actual_credits: number;
          p_billing_status?: "charged" | "not_billed" | "refunded";
        };
        Returns: ExtendedMusicVideoGeneration;
      };
    };
  };
};
